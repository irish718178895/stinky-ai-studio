import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILES_DIR } from "../config.js";
import { readProjects, writeProjects, publicProject } from "../services/project-store.js";
import { normalizeProviderManifest, validateProviderManifest } from "../providers/manager.js";

const router = express.Router();

router.get("/api/projects", async (_req, res) => {
  try {
    const projects = await readProjects();
    res.json(projects.map(publicProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/projects", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "Project name is required." });

    const projects = await readProjects();
    const now = new Date().toISOString();
    const project = {
      id: crypto.randomUUID(),
      name,
      description: String(req.body.description || "").trim().slice(0, 500),
      providers: req.body.providers === undefined
        ? normalizeProviderManifest()
        : validateProviderManifest(req.body.providers),
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

router.get("/api/projects/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });
    res.json(publicProject(project));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/api/projects/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });

    const name = String(req.body.name ?? project.name).trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: "Project name is required." });

    project.name = name;
    project.description = String(req.body.description ?? project.description ?? "").trim().slice(0, 500);

    if (req.body.providers !== undefined) {
      project.providers = validateProviderManifest({
        ...project.providers,
        ...req.body.providers
      });
    }

    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    res.json(publicProject(project));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/projects/:id", async (req, res) => {
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


router.post("/api/projects/:id/scenes", async (req, res) => {
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

router.patch("/api/projects/:projectId/scenes/:sceneId", async (req, res) => {
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

router.delete("/api/projects/:projectId/scenes/:sceneId", async (req, res) => {
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

router.post("/api/projects/:projectId/scenes/:sceneId/move", async (req, res) => {
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

export default router;
