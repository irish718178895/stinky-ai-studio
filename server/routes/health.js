import express from "express";
import path from "node:path";
import { COMFY_URL, CHECKPOINT, OLLAMA_URL, OLLAMA_MODEL, PIPER_COMMAND, PIPER_MODEL } from "../config.js";
import { comfyFetch } from "../services/comfyui.js";
import { requirePiper } from "../services/piper.js";

const router = express.Router();

router.get("/api/health", async (_req, res) => {
  try {
    const response = await comfyFetch("/system_stats");
    res.json({ ok: true, comfyUrl: COMFY_URL, checkpoint: CHECKPOINT, stats: await response.json() });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

router.get("/api/piper/health", async (_req, res) => {
  try {
    await requirePiper();
    res.json({ ok: true, command: PIPER_COMMAND, model: path.basename(PIPER_MODEL) });
  } catch (error) {
    res.status(503).json({ ok: false, command: PIPER_COMMAND, model: PIPER_MODEL, error: error.message });
  }
});

router.get("/api/ollama/health", async (_req, res) => {
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

export default router;
