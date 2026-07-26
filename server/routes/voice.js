import express from "express";
import { readProjects, writeProjects } from "../services/project-store.js";
import { getProvider } from "../providers/registry.js";

const voiceProvider = getProvider("voice");

const router = express.Router();

router.post("/api/projects/:projectId/scenes/:sceneId/voice", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const scene = project.scenes.find(item => item.id === req.params.sceneId);
    if (!scene) return res.status(404).json({ error: "Scene not found." });
    await voiceProvider.synthesize(project, scene, req.body.lengthScale);
    await writeProjects(projects);
    res.json(scene);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/projects/:projectId/generate-scene-voices", async (req, res) => {
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
        await voiceProvider.synthesize(project, scene, req.body.lengthScale);
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

export default router;
