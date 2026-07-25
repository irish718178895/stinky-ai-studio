import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { generateStoryboard } from "../modules/storyboard.js";
import {
  PORT, COMFY_URL, CHECKPOINT, OLLAMA_URL, OLLAMA_MODEL,
  PROJECT_FILES_DIR, PUBLIC_DIR, PIPER_COMMAND, PIPER_MODEL
} from "./config.js";
import { ensureStorage, readProjects, writeProjects, publicProject } from "./services/project-store.js";
import { comfyFetch, generateForProject } from "./services/comfyui.js";
import { requirePiper, synthesizeSceneVoice } from "./services/piper.js";
import { normalizeRenderSettings, renderProjectVideo } from "./services/ffmpeg/video-renderer.js";
import { safeMusicExtension } from "./utils/media.js";

const app = express();
const renderJobs = new Map();
const imageJobs = new Map();

app.use(express.json({ limit: "40mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/generated", express.static(PROJECT_FILES_DIR));

app.get("/api/health", async (_req, res) => {
  try {
    const response = await comfyFetch("/system_stats");
    res.json({ ok: true, comfyUrl: COMFY_URL, checkpoint: CHECKPOINT, stats: await response.json() });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get("/api/piper/health", async (_req, res) => {
  try {
    await requirePiper();
    res.json({ ok: true, command: PIPER_COMMAND, model: path.basename(PIPER_MODEL) });
  } catch (error) {
    res.status(503).json({ ok: false, command: PIPER_COMMAND, model: PIPER_MODEL, error: error.message });
  }
});

app.post("/api/projects/:projectId/scenes/:sceneId/voice", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const scene = project.scenes.find(item => item.id === req.params.sceneId);
    if (!scene) return res.status(404).json({ error: "Scene not found." });
    await synthesizeSceneVoice(project, scene, req.body.lengthScale);
    await writeProjects(projects);
    res.json(scene);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects/:projectId/generate-scene-voices", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const regenerate = Boolean(req.body.regenerate);
    const scenes = [...project.scenes].sort((a, b) => a.order - b.order)
      .filter(scene => String(scene.narration || "").trim() && (regenerate || !scene.voiceUrl));
    const results = [];
    for (const scene of scenes) {
      try {
        await synthesizeSceneVoice(project, scene, req.body.lengthScale);
        results.push({ sceneId: scene.id, title: scene.title, ok: true, voiceUrl: scene.voiceUrl });
      } catch (error) {
        results.push({ sceneId: scene.id, title: scene.title, ok: false, error: error.message });
      }
    }
    await writeProjects(projects);
    res.json({ generated: results.filter(item => item.ok).length, total: results.length, results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


app.post("/api/projects/:projectId/music", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const filename = String(req.body.filename || "music").slice(0, 180);
    const mimeType = String(req.body.mimeType || "");
    const encoded = String(req.body.dataBase64 || "");
    if (!encoded) return res.status(400).json({ error: "No audio data was supplied." });
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length || buffer.length > 30 * 1024 * 1024) return res.status(400).json({ error: "Music file must be between 1 byte and 30 MB." });
    const extension = safeMusicExtension(filename, mimeType);
    const id = crypto.randomUUID();
    const musicDir = path.join(PROJECT_FILES_DIR, project.id, "music");
    await fs.mkdir(musicDir, { recursive: true });
    const storedName = `${id}${extension}`;
    await fs.writeFile(path.join(musicDir, storedName), buffer);
    const now = new Date().toISOString();
    const record = { id, name: path.basename(filename), mimeType, fileSize: buffer.length, url: `/generated/${encodeURIComponent(project.id)}/music/${encodeURIComponent(storedName)}`, createdAt: now };
    project.musicTracks = Array.isArray(project.musicTracks) ? project.musicTracks : [];
    project.musicTracks.unshift(record);
    project.updatedAt = now;
    await writeProjects(projects);
    res.status(201).json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/projects/:projectId/music/:musicId", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const index = (project.musicTracks || []).findIndex(item => item.id === req.params.musicId);
    if (index < 0) return res.status(404).json({ error: "Music track not found." });
    const [track] = project.musicTracks.splice(index, 1);
    const storedPath = path.join(PROJECT_FILES_DIR, project.id, "music", path.basename(new URL(track.url, "http://local").pathname));
    await fs.rm(storedPath, { force: true });
    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/ollama/health", async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) throw new Error(`Ollama ${response.status}`);
    const data = await response.json();
    const models = (data.models || []).map(item => item.name);
    res.json({ ok: true, url: OLLAMA_URL, model: OLLAMA_MODEL, installed: models.includes(OLLAMA_MODEL), models });
  } catch (error) {
    res.status(503).json({ ok: false, url: OLLAMA_URL, model: OLLAMA_MODEL, error: error.message });
  }
});

app.post("/api/projects/:id/storyboard", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const idea = String(req.body.idea || "").trim();
    if (!idea) return res.status(400).json({ error: "Commercial idea is required." });
    const storyboard = await generateStoryboard({
      ollamaUrl: OLLAMA_URL,
      model: String(req.body.model || OLLAMA_MODEL),
      idea,
      length: Number(req.body.length) || 30,
      style: String(req.body.style || "cinematic"),
      audience: String(req.body.audience || "general audience")
    });
    const now = new Date().toISOString();
    const newScenes = storyboard.scenes.map((scene, index) => ({
      id: crypto.randomUUID(),
      title: scene.title,
      description: scene.description,
      imagePrompt: scene.imagePrompt,
      narration: scene.narration,
      duration: scene.duration,
      cameraMovement: scene.cameraMovement,
      imageId: null,
      order: index,
      createdAt: now,
      updatedAt: now
    }));
    if (req.body.replaceExisting === false) {
      const offset = project.scenes.length;
      newScenes.forEach((scene, index) => { scene.order = offset + index; });
      project.scenes.push(...newScenes);
    } else {
      project.scenes = newScenes;
    }
    project.storyboard = {
      idea, length: Number(req.body.length) || 30, style: String(req.body.style || "cinematic"),
      audience: String(req.body.audience || "general audience"), model: String(req.body.model || OLLAMA_MODEL),
      title: storyboard.title, summary: storyboard.summary, generatedAt: now
    };
    project.updatedAt = now;
    await writeProjects(projects);
    res.status(201).json({ storyboard: project.storyboard, scenes: newScenes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await readProjects();
    res.json(projects.map(publicProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "Project name is required." });

    const projects = await readProjects();
    const now = new Date().toISOString();
    const project = {
      id: crypto.randomUUID(),
      name,
      description: String(req.body.description || "").trim().slice(0, 500),
      createdAt: now,
      updatedAt: now,
      images: [],
      videos: [],
      musicTracks: [],
      scenes: []
    };
    projects.push(project);
    await writeProjects(projects);
    res.status(201).json(publicProject(project));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });
    res.json(publicProject(project));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/projects/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });

    const name = String(req.body.name ?? project.name).trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "Project name is required." });

    project.name = name;
    project.description = String(req.body.description ?? project.description ?? "").trim().slice(0, 500);
    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    res.json(publicProject(project));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const index = projects.findIndex(item => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Project not found." });

    const [project] = projects.splice(index, 1);
    await writeProjects(projects);
    await fs.rm(path.join(PROJECT_FILES_DIR, project.id), { recursive: true, force: true });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.post("/api/projects/:id/scenes", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });

    const title = String(req.body.title || `Scene ${project.scenes.length + 1}`).trim().slice(0, 100);
    if (!title) return res.status(400).json({ error: "Scene title is required." });

    const now = new Date().toISOString();
    const scene = {
      id: crypto.randomUUID(),
      title,
      description: String(req.body.description || "").trim().slice(0, 500),
      imagePrompt: String(req.body.imagePrompt || req.body.description || "").trim().slice(0, 4000),
      narration: String(req.body.narration || "").trim().slice(0, 2000),
      voiceUrl: null,
      voiceModel: null,
      voiceLengthScale: 1,
      voiceGeneratedAt: null,
      duration: Math.min(60, Math.max(1, Number(req.body.duration) || 5)),
      cameraMovement: ["none", "zoom-in", "zoom-out", "pan-left", "pan-right"].includes(req.body.cameraMovement)
        ? req.body.cameraMovement
        : "zoom-in",
      imageId: project.images.some(image => image.id === req.body.imageId) ? req.body.imageId : null,
      order: project.scenes.length,
      createdAt: now,
      updatedAt: now
    };

    project.scenes.push(scene);
    project.updatedAt = now;
    await writeProjects(projects);
    res.status(201).json(scene);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/projects/:projectId/scenes/:sceneId", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const scene = project.scenes.find(item => item.id === req.params.sceneId);
    if (!scene) return res.status(404).json({ error: "Scene not found." });

    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim().slice(0, 100);
      if (!title) return res.status(400).json({ error: "Scene title is required." });
      scene.title = title;
    }
    if (req.body.description !== undefined) scene.description = String(req.body.description).trim().slice(0, 500);
    if (req.body.imagePrompt !== undefined) scene.imagePrompt = String(req.body.imagePrompt).trim().slice(0, 4000);
    if (req.body.narration !== undefined) {
      const nextNarration = String(req.body.narration).trim().slice(0, 2000);
      if (nextNarration !== scene.narration) { scene.voiceUrl = null; scene.voiceGeneratedAt = null; }
      scene.narration = nextNarration;
    }
    if (req.body.duration !== undefined) scene.duration = Math.min(60, Math.max(1, Number(req.body.duration) || 5));
    if (req.body.cameraMovement !== undefined) {
      if (!["none", "zoom-in", "zoom-out", "pan-left", "pan-right"].includes(req.body.cameraMovement)) {
        return res.status(400).json({ error: "Invalid camera movement." });
      }
      scene.cameraMovement = req.body.cameraMovement;
    }
    if (req.body.imageId !== undefined) {
      if (req.body.imageId !== null && !project.images.some(image => image.id === req.body.imageId)) {
        return res.status(400).json({ error: "Selected image does not exist in this project." });
      }
      scene.imageId = req.body.imageId;
    }

    scene.updatedAt = new Date().toISOString();
    project.updatedAt = scene.updatedAt;
    await writeProjects(projects);
    res.json(scene);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/projects/:projectId/scenes/:sceneId", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const index = project.scenes.findIndex(item => item.id === req.params.sceneId);
    if (index < 0) return res.status(404).json({ error: "Scene not found." });

    project.scenes.splice(index, 1);
    project.scenes.forEach((scene, order) => { scene.order = order; });
    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects/:projectId/scenes/:sceneId/move", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const index = project.scenes.findIndex(item => item.id === req.params.sceneId);
    if (index < 0) return res.status(404).json({ error: "Scene not found." });

    const direction = req.body.direction;
    const target = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
    if (target < 0 || target >= project.scenes.length) return res.json(project.scenes);

    [project.scenes[index], project.scenes[target]] = [project.scenes[target], project.scenes[index]];
    project.scenes.forEach((scene, order) => {
      scene.order = order;
      scene.updatedAt = new Date().toISOString();
    });
    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    res.json(project.scenes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




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



app.post("/api/projects/:id/generate-scene-images", async (req, res) => {
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

app.get("/api/image-jobs/:jobId", (req, res) => {
  const job = imageJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Image job not found." });
  res.json(publicImageJob(job));
});

app.post("/api/image-jobs/:jobId/cancel", (req, res) => {
  const job = imageJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Image job not found." });
  if (["complete", "complete-with-errors", "cancelled", "error"].includes(job.status)) return res.json(publicImageJob(job));
  job.cancelRequested = true;
  job.stage = "Cancellation requested; finishing current scene";
  job.updatedAt = new Date().toISOString();
  res.json(publicImageJob(job));
});

app.post("/api/projects/:id/render-video", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const settings = normalizeRenderSettings(req.body || {});
    const jobId = crypto.randomUUID();
    const job = { id: jobId, projectId: project.id, status: "queued", progress: 0, stage: "Queued", createdAt: new Date().toISOString() };
    renderJobs.set(jobId, job);
    res.status(202).json(job);

    queueMicrotask(async () => {
      try {
        job.status = "running";
        const video = await renderProjectVideo(project, settings, patch => Object.assign(job, patch));
        await writeProjects(projects);
        Object.assign(job, { status: "complete", progress: 100, stage: "Complete", video });
      } catch (error) {
        console.error(error);
        Object.assign(job, { status: "error", stage: "Failed", error: error.message });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/render-jobs/:jobId", (req, res) => {
  const job = renderJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Render job not found." });
  res.json(job);
});

app.delete("/api/projects/:projectId/videos/:videoId", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const index=(project.videos||[]).findIndex(v=>v.id===req.params.videoId);
    if(index<0) return res.status(404).json({error:"Video not found."});
    const [video]=project.videos.splice(index,1);
    await writeProjects(projects);
    await fs.rm(path.join(PROJECT_FILES_DIR,project.id,"videos",path.basename(video.filename)),{force:true});
    res.status(204).end();
  } catch(error){ res.status(500).json({error:error.message}); }
});

app.post("/api/projects/:id/generate", async (req, res) => {
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

app.post("/api/projects/:projectId/images/:imageId/regenerate", async (req, res) => {
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

app.delete("/api/projects/:projectId/images/:imageId", async (req, res) => {
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

await ensureStorage();
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Stinky AI Studio v0.11.1: http://127.0.0.1:${PORT}`);
  console.log(`ComfyUI API: ${COMFY_URL}`);
  console.log(`Checkpoint: ${CHECKPOINT}`);
  console.log(`Ollama: ${OLLAMA_URL} (${OLLAMA_MODEL})`);
  console.log(`Piper: ${PIPER_COMMAND} (${PIPER_MODEL})`);
});
