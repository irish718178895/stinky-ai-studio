import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILES_DIR } from "../config.js";
import { readProjects, writeProjects } from "../services/project-store.js";
import { selectProvider } from "../providers/manager.js";
import { jobs } from "../services/job-manager.js";


const router = express.Router();


router.post("/api/projects/:id/render-video", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });
const renderProvider = selectProvider(
  "render",
  project.providers
);
	  const settings = renderProvider.normalizeSettings(req.body || {});
    const job = jobs.create("render", { projectId: project.id });
    res.status(202).json(job);

    queueMicrotask(async () => {
      try {
        jobs.patch(job, { status: "running" });
        const video = await renderProvider.render(project, settings, patch => jobs.patch(job, patch));
        await writeProjects(projects);
        jobs.patch(job, { status: "complete", progress: 100, stage: "Complete", video });
      } catch (error) {
        console.error(error);
        jobs.patch(job, { status: "error", stage: "Failed", error: error.message });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/render-jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId, "render");
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
