import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILES_DIR } from "../config.js";
import { readProjects, writeProjects } from "../services/project-store.js";
import { generateForProject } from "../services/comfyui.js";

const router = express.Router();

const imageJobs = new Map();

function publicImageJob(job) {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    currentSceneId: job.currentSceneId || null,
    completed: job.completed || 0,
    total: job.total || 0,
    cancelled: Boolean(job.cancelled),
    error: job.error || null,
    scenes: job.scenes || [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

async function runSceneImageJob(job, defaults) {
  try {
    job.status = "running";
    job.stage = "Preparing scene queue";
    job.updatedAt = new Date().toISOString();

    for (let index = 0; index < job.sceneIds.length; index++) {
      if (job.cancelRequested) {
        job.cancelled = true;
        job.status = "cancelled";
        job.stage = "Cancelled after current scene";
        job.updatedAt = new Date().toISOString();
        return;
      }

      const projects = await readProjects();
      const project = projects.find(item => item.id === job.projectId);
      if (!project) throw new Error("Project was deleted while image generation was running.");
      const scene = project.scenes.find(item => item.id === job.sceneIds[index]);
      const item = job.scenes.find(entry => entry.sceneId === job.sceneIds[index]);
      if (!scene) {
        item.status = "skipped";
        item.error = "Scene no longer exists.";
        job.completed += 1;
        continue;
      }

      const prompt = String(scene.imagePrompt || scene.description || "").trim();
      if (!prompt) {
        item.status = "error";
        item.error = "Scene has no image prompt.";
        job.completed += 1;
        continue;
      }

      job.currentSceneId = scene.id;
      job.stage = `Generating scene ${index + 1} of ${job.total}: ${scene.title}`;
      item.status = "running";
      job.updatedAt = new Date().toISOString();

      try {
        const result = await generateForProject(projects, project, { ...defaults, prompt });
        const generated = result.images[0];
        const refreshedProjects = await readProjects();
        const refreshedProject = refreshedProjects.find(entry => entry.id === job.projectId);
        const refreshedScene = refreshedProject?.scenes.find(entry => entry.id === scene.id);
        if (refreshedScene && generated) {
          refreshedScene.imageId = generated.id;
          refreshedScene.updatedAt = new Date().toISOString();
          refreshedProject.updatedAt = refreshedScene.updatedAt;
          await writeProjects(refreshedProjects);
        }
        item.status = "complete";
        item.imageId = generated?.id || null;
        item.seed = result.seed;
      } catch (error) {
        item.status = "error";
        item.error = error.message;
      }

      job.completed += 1;
      job.progress = Math.round((job.completed / Math.max(1, job.total)) * 100);
      job.updatedAt = new Date().toISOString();
    }

    job.currentSceneId = null;
    const failures = job.scenes.filter(item => item.status === "error").length;
    job.status = failures ? "complete-with-errors" : "complete";
    job.stage = failures ? `Complete with ${failures} failed scene${failures === 1 ? "" : "s"}` : "All scene images complete";
    job.progress = 100;
    job.updatedAt = new Date().toISOString();
  } catch (error) {
    console.error(error);
    job.status = "error";
    job.stage = "Batch generation failed";
    job.error = error.message;
    job.updatedAt = new Date().toISOString();
  }
}



router.post("/api/projects/:id/generate-scene-images", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });

    const onlyMissing = req.body?.onlyMissing !== false;
    const requestedSceneIds = Array.isArray(req.body?.sceneIds) ? new Set(req.body.sceneIds.map(String)) : null;
    const scenes = [...(project.scenes || [])]
      .sort((a, b) => a.order - b.order)
      .filter(scene => (!requestedSceneIds || requestedSceneIds.has(scene.id)) && (!onlyMissing || !scene.imageId));

    if (!scenes.length) return res.status(400).json({ error: onlyMissing ? "Every selected scene already has an image." : "No scenes were selected." });
    const missingPrompt = scenes.find(scene => !String(scene.imagePrompt || scene.description || "").trim());
    if (missingPrompt) return res.status(400).json({ error: `Scene “${missingPrompt.title}” has no image prompt.` });

    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      projectId: project.id,
      status: "queued",
      progress: 0,
      stage: "Queued",
      completed: 0,
      total: scenes.length,
      sceneIds: scenes.map(scene => scene.id),
      scenes: scenes.map(scene => ({ sceneId: scene.id, title: scene.title, status: "queued", imageId: null, seed: null, error: null })),
      cancelRequested: false,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    imageJobs.set(jobId, job);

    const defaults = {
      negativePrompt: String(req.body?.negativePrompt || "cartoon, anime, illustration, CGI, blurry, low quality, watermark, logo, text, duplicate person, deformed hands, extra fingers"),
      width: Math.min(768, Math.max(256, Number(req.body?.width) || 512)),
      height: Math.min(768, Math.max(256, Number(req.body?.height) || 512)),
      steps: Math.min(40, Math.max(1, Number(req.body?.steps) || 20)),
      cfg: Math.min(15, Math.max(1, Number(req.body?.cfg) || 7))
    };

    res.status(202).json(publicImageJob(job));
    queueMicrotask(() => runSceneImageJob(job, defaults));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/image-jobs/:jobId", (req, res) => {
  const job = imageJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Image job not found." });
  res.json(publicImageJob(job));
});

router.post("/api/image-jobs/:jobId/cancel", (req, res) => {
  const job = imageJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Image job not found." });
  if (["complete", "complete-with-errors", "cancelled", "error"].includes(job.status)) return res.json(publicImageJob(job));
  job.cancelRequested = true;
  job.stage = "Cancellation requested; finishing current scene";
  job.updatedAt = new Date().toISOString();
  res.json(publicImageJob(job));
});

router.post("/api/projects/:id/generate", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });
    res.json(await generateForProject(projects, project, req.body));
  } catch (error) {
    console.error(error);
    const status = error.message === "Prompt is required." ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

router.post("/api/projects/:projectId/images/:imageId/regenerate", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const image = project.images.find(item => item.id === req.params.imageId);
    if (!image) return res.status(404).json({ error: "Image not found." });

    const settings = {
      prompt: image.prompt,
      negativePrompt: image.negativePrompt,
      width: image.width,
      height: image.height,
      steps: image.steps,
      cfg: image.cfg,
      seed: req.body?.randomSeed ? undefined : image.seed
    };
    res.json(await generateForProject(projects, project, settings, image.id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/projects/:projectId/images/:imageId", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const index = project.images.findIndex(image => image.id === req.params.imageId);
    if (index < 0) return res.status(404).json({ error: "Image not found." });
    const [image] = project.images.splice(index, 1);
    for (const scene of project.scenes || []) {
      if (scene.imageId === image.id) {
        scene.imageId = null;
        scene.updatedAt = new Date().toISOString();
      }
    }
    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    const filePath = path.join(PROJECT_FILES_DIR, project.id, path.basename(new URL(image.url, "http://local").pathname));
    await fs.rm(filePath, { force: true });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
