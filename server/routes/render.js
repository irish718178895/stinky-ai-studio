import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILES_DIR } from "../config.js";
import { readProjects, writeProjects } from "../services/project-store.js";
import { normalizeRenderSettings, renderProjectVideo } from "../services/ffmpeg/video-renderer.js";

const router = express.Router();

const renderJobs = new Map();

router.post("/api/projects/:id/render-video", async (req, res) => {
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

router.get("/api/render-jobs/:jobId", (req, res) => {
  const job = renderJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Render job not found." });
  res.json(job);
});

router.delete("/api/projects/:projectId/videos/:videoId", async (req, res) => {
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

export default router;
