import express from "express";
import crypto from "node:crypto";
import { generateStoryboard } from "../../modules/storyboard.js";
import { OLLAMA_URL, OLLAMA_MODEL } from "../config.js";
import { readProjects, writeProjects } from "../services/project-store.js";

const router = express.Router();

router.post("/api/projects/:id/storyboard", async (req, res) => {
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

export default router;
