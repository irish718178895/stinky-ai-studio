import express from "express";
import { readProjects, writeProjects } from "../services/project-store.js";
import { selectProvider } from "../providers/manager.js";

const router = express.Router();

function collectVoiceSettings(body = {}) {
  return Object.fromEntries(
    Object.entries({
      voice: body.voice,
      lengthScale: body.lengthScale
    }).filter(([, value]) => value !== undefined)
  );
}

router.post("/api/projects/:projectId/scenes/:sceneId/voice", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const scene = project.scenes.find(item => item.id === req.params.sceneId);

    if (!scene) {
      return res.status(404).json({ error: "Scene not found." });
    }

    const voiceProvider = selectProvider(
      "voice",
      project.providers
    );

    await voiceProvider.synthesize(
      project,
      scene,
      collectVoiceSettings(req.body)
    );

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

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const voiceProvider = selectProvider(
      "voice",
      project.providers
    );

    const regenerate = Boolean(req.body.regenerate);
    const settings = collectVoiceSettings(req.body);
    const scenes = [...project.scenes]
      .sort((a, b) => a.order - b.order)
      .filter(scene =>
        String(scene.narration || "").trim() &&
        (regenerate || !scene.voiceUrl)
      );

    const results = [];

    for (const scene of scenes) {
      try {
        await voiceProvider.synthesize(project, scene, settings);

        results.push({
          sceneId: scene.id,
          title: scene.title,
          ok: true,
          voiceUrl: scene.voiceUrl,
          voiceModel: scene.voiceModel,
          voiceLengthScale: scene.voiceLengthScale
        });
      } catch (error) {
        results.push({
          sceneId: scene.id,
          title: scene.title,
          ok: false,
          error: error.message
        });
      }
    }

    await writeProjects(projects);

    res.json({
      generated: results.filter(item => item.ok).length,
      total: results.length,
      results
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
