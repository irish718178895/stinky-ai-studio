import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILES_DIR } from "../config.js";
import {
  readProjects,
  writeProjects
} from "../services/project-store.js";
import { selectProvider } from "../providers/manager.js";
import { jobs } from "../services/job-manager.js";

const router = express.Router();

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
    jobs.patch(job, {
      status: "running",
      stage: "Preparing scene queue"
    });

    for (
      let index = 0;
      index < job.sceneIds.length;
      index++
    ) {
      if (job.cancelRequested) {
        jobs.patch(job, {
          cancelled: true,
          status: "cancelled",
          stage: "Cancelled after current scene"
        });

        return;
      }

      const projects = await readProjects();

      const project = projects.find(
        item => item.id === job.projectId
      );

      if (!project) {
        throw new Error(
          "Project was deleted while image generation was running."
        );
      }

      const imageProvider = selectProvider(
        "image",
        project.providers
      );

      const scene = project.scenes.find(
        item => item.id === job.sceneIds[index]
      );

      const item = job.scenes.find(
        entry => entry.sceneId === job.sceneIds[index]
      );

      if (!scene) {
        item.status = "skipped";
        item.error = "Scene no longer exists.";
        job.completed += 1;
        continue;
      }

      const prompt = String(
        scene.imagePrompt ||
        scene.description ||
        ""
      ).trim();

      if (!prompt) {
        item.status = "error";
        item.error = "Scene has no image prompt.";
        job.completed += 1;
        continue;
      }

      job.currentSceneId = scene.id;
      job.stage =
        `Generating scene ${index + 1} of ` +
        `${job.total}: ${scene.title}`;

      item.status = "running";
      jobs.patch(job);

      try {
        const result = await imageProvider.generate(
          projects,
          project,
          {
            ...defaults,
            prompt
          }
        );

        const generated = result.images[0];

        const refreshedProjects =
          await readProjects();

        const refreshedProject =
          refreshedProjects.find(
            entry => entry.id === job.projectId
          );

        const refreshedScene =
          refreshedProject?.scenes.find(
            entry => entry.id === scene.id
          );

        if (refreshedScene && generated) {
          refreshedScene.imageId = generated.id;
          refreshedScene.updatedAt =
            new Date().toISOString();

          refreshedProject.updatedAt =
            refreshedScene.updatedAt;

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

      job.progress = Math.round(
        (
          job.completed /
          Math.max(1, job.total)
        ) * 100
      );

      jobs.patch(job);
    }

    job.currentSceneId = null;

    const failures = job.scenes.filter(
      item => item.status === "error"
    ).length;

    job.status = failures
      ? "complete-with-errors"
      : "complete";

    job.stage = failures
      ? `Complete with ${failures} failed scene${
          failures === 1 ? "" : "s"
        }`
      : "All scene images complete";

    job.progress = 100;

    jobs.patch(job);
  } catch (error) {
    console.error(error);

    job.status = "error";
    job.stage = "Batch generation failed";
    job.error = error.message;

    jobs.patch(job);
  }
}

router.post(
  "/api/projects/:id/generate-scene-images",
  async (req, res) => {
    try {
      const projects = await readProjects();

      const project = projects.find(
        item => item.id === req.params.id
      );

      if (!project) {
        return res.status(404).json({
          error: "Project not found."
        });
      }

      const onlyMissing =
        req.body?.onlyMissing !== false;

      const requestedSceneIds =
        Array.isArray(req.body?.sceneIds)
          ? new Set(
              req.body.sceneIds.map(String)
            )
          : null;

      const scenes = [
        ...(project.scenes || [])
      ]
        .sort((a, b) => a.order - b.order)
        .filter(
          scene =>
            (
              !requestedSceneIds ||
              requestedSceneIds.has(scene.id)
            ) &&
            (
              !onlyMissing ||
              !scene.imageId
            )
        );

      if (!scenes.length) {
        return res.status(400).json({
          error: onlyMissing
            ? "Every selected scene already has an image."
            : "No scenes were selected."
        });
      }

      const missingPrompt = scenes.find(
        scene =>
          !String(
            scene.imagePrompt ||
            scene.description ||
            ""
          ).trim()
      );

      if (missingPrompt) {
        return res.status(400).json({
          error:
            `Scene “${missingPrompt.title}” ` +
            "has no image prompt."
        });
      }

      const job = jobs.create("image", {
        projectId: project.id,
        completed: 0,
        total: scenes.length,
        currentSceneId: null,
        sceneIds: scenes.map(
          scene => scene.id
        ),
        scenes: scenes.map(scene => ({
          sceneId: scene.id,
          title: scene.title,
          status: "queued",
          imageId: null,
          seed: null,
          error: null
        }))
      });

      const defaults = {
        negativePrompt: String(
          req.body?.negativePrompt ||
          "cartoon, anime, illustration, CGI, blurry, " +
          "low quality, watermark, logo, text, duplicate " +
          "person, deformed hands, extra fingers"
        ),

        width: Math.min(
          768,
          Math.max(
            256,
            Number(req.body?.width) || 512
          )
        ),

        height: Math.min(
          768,
          Math.max(
            256,
            Number(req.body?.height) || 512
          )
        )
      };

      if (req.body?.steps !== undefined) {
        defaults.steps = Number(req.body.steps);
      }

      if (req.body?.cfg !== undefined) {
        defaults.cfg = Number(req.body.cfg);
      }

      if (req.body?.checkpoint !== undefined) {
        defaults.checkpoint =
          String(req.body.checkpoint);
      }

      if (req.body?.sampler !== undefined) {
        defaults.sampler =
          String(req.body.sampler);
      }

      if (req.body?.scheduler !== undefined) {
        defaults.scheduler =
          String(req.body.scheduler);
      }

      res.status(202).json(
        publicImageJob(job)
      );

      queueMicrotask(() =>
        runSceneImageJob(job, defaults)
      );
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

router.get(
  "/api/image-jobs/:jobId",
  (req, res) => {
    const job = jobs.get(
      req.params.jobId,
      "image"
    );

    if (!job) {
      return res.status(404).json({
        error: "Image job not found."
      });
    }

    res.json(publicImageJob(job));
  }
);

router.post(
  "/api/image-jobs/:jobId/cancel",
  (req, res) => {
    const job = jobs.get(
      req.params.jobId,
      "image"
    );

    if (!job) {
      return res.status(404).json({
        error: "Image job not found."
      });
    }

    if (
      [
        "complete",
        "complete-with-errors",
        "cancelled",
        "error"
      ].includes(job.status)
    ) {
      return res.json(publicImageJob(job));
    }

    jobs.requestCancel(
      job,
      "Cancellation requested; finishing current scene"
    );

    res.json(publicImageJob(job));
  }
);

router.post(
  "/api/projects/:id/generate",
  async (req, res) => {
    try {
      const projects = await readProjects();

      const project = projects.find(
        item => item.id === req.params.id
      );

      if (!project) {
        return res.status(404).json({
          error: "Project not found."
        });
      }

      const imageProvider = selectProvider(
        "image",
        project.providers
      );

      res.json(
        await imageProvider.generate(
          projects,
          project,
          req.body || {}
        )
      );
    } catch (error) {
      console.error(error);

      const status =
        error.message === "Prompt is required."
          ? 400
          : 500;

      res.status(status).json({
        error: error.message
      });
    }
  }
);

router.post(
  "/api/projects/:projectId/images/:imageId/regenerate",
  async (req, res) => {
    try {
      const projects = await readProjects();

      const project = projects.find(
        item =>
          item.id === req.params.projectId
      );

      if (!project) {
        return res.status(404).json({
          error: "Project not found."
        });
      }

      const image = project.images.find(
        item =>
          item.id === req.params.imageId
      );

      if (!image) {
        return res.status(404).json({
          error: "Image not found."
        });
      }

      const imageProvider = selectProvider(
        "image",
        project.providers
      );

      const settings = {
        prompt: image.prompt,
        negativePrompt: image.negativePrompt,
        width: image.width,
        height: image.height,
        steps: image.steps,
        cfg: image.cfg,
        checkpoint: image.checkpoint,
        sampler: image.sampler,
        scheduler: image.scheduler,
        seed: req.body?.randomSeed
          ? undefined
          : image.seed
      };

      res.json(
        await imageProvider.generate(
          projects,
          project,
          settings,
          image.id
        )
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: error.message
      });
    }
  }
);

router.delete(
  "/api/projects/:projectId/images/:imageId",
  async (req, res) => {
    try {
      const projects = await readProjects();

      const project = projects.find(
        item =>
          item.id === req.params.projectId
      );

      if (!project) {
        return res.status(404).json({
          error: "Project not found."
        });
      }

      const index = project.images.findIndex(
        image =>
          image.id === req.params.imageId
      );

      if (index < 0) {
        return res.status(404).json({
          error: "Image not found."
        });
      }

      const [image] = project.images.splice(
        index,
        1
      );

      for (const scene of project.scenes || []) {
        if (scene.imageId === image.id) {
          scene.imageId = null;
          scene.updatedAt =
            new Date().toISOString();
        }
      }

      project.updatedAt =
        new Date().toISOString();

      await writeProjects(projects);

      const filePath = path.join(
        PROJECT_FILES_DIR,
        project.id,
        path.basename(
          new URL(
            image.url,
            "http://local"
          ).pathname
        )
      );

      await fs.rm(filePath, {
        force: true
      });

      res.status(204).end();
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

export default router;
