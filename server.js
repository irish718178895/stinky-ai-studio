import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const COMFY_URL = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const CHECKPOINT = process.env.CHECKPOINT || "dreamshaper_8.safetensors";
const DATA_DIR = path.join(__dirname, "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const PROJECT_FILES_DIR = path.join(DATA_DIR, "projects");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/generated", express.static(PROJECT_FILES_DIR));

async function ensureStorage() {
  await fs.mkdir(PROJECT_FILES_DIR, { recursive: true });
  try {
    await fs.access(PROJECTS_FILE);
  } catch {
    await writeProjects([]);
  }
}

async function readProjects() {
  await ensureStorage();
  const raw = await fs.readFile(PROJECTS_FILE, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function writeProjects(projects) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${PROJECTS_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  await fs.rename(temp, PROJECTS_FILE);
}

function publicProject(project) {
  return {
    ...project,
    images: [...(project.images || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  };
}

function makeWorkflow({ prompt, negativePrompt, width, height, steps, cfg, seed }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CHECKPOINT } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0]
      }
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "Stinky_AI_Studio", images: ["6", 0] }
    }
  };
}

async function comfyFetch(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ComfyUI ${response.status}: ${body || response.statusText}`);
  }
  return response;
}

async function waitForResult(promptId, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await comfyFetch(`/history/${encodeURIComponent(promptId)}`);
    const history = await response.json();
    const job = history[promptId];

    if (job?.status?.status_str === "error") {
      throw new Error(`ComfyUI generation failed: ${JSON.stringify(job.status.messages || [])}`);
    }

    const images = [];
    for (const output of Object.values(job?.outputs || {})) {
      for (const image of output.images || []) images.push(image);
    }
    if (images.length) return images;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for ComfyUI to finish.");
}

async function copyComfyImage(image, projectId, imageId) {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || "",
    type: image.type || "output"
  });
  const response = await comfyFetch(`/view?${query}`);
  const extension = path.extname(image.filename) || ".png";
  const projectDir = path.join(PROJECT_FILES_DIR, projectId);
  await fs.mkdir(projectDir, { recursive: true });
  const storedName = `${imageId}${extension}`;
  await fs.writeFile(path.join(projectDir, storedName), Buffer.from(await response.arrayBuffer()));
  return `/generated/${encodeURIComponent(projectId)}/${encodeURIComponent(storedName)}`;
}

app.get("/api/health", async (_req, res) => {
  try {
    const response = await comfyFetch("/system_stats");
    res.json({ ok: true, comfyUrl: COMFY_URL, checkpoint: CHECKPOINT, stats: await response.json() });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
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
      images: []
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

app.post("/api/projects/:id/generate", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found." });

    const prompt = String(req.body.prompt || "").trim();
    const negativePrompt = String(req.body.negativePrompt || "").trim();
    const width = Math.min(768, Math.max(256, Number(req.body.width) || 512));
    const height = Math.min(768, Math.max(256, Number(req.body.height) || 512));
    const steps = Math.min(40, Math.max(1, Number(req.body.steps) || 20));
    const cfg = Math.min(15, Math.max(1, Number(req.body.cfg) || 7));
    const suppliedSeed = Number(req.body.seed);
    const seed = Number.isSafeInteger(suppliedSeed) && suppliedSeed > 0
      ? suppliedSeed
      : crypto.randomInt(1, 2_147_483_647);

    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const queued = await comfyFetch("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: makeWorkflow({ prompt, negativePrompt, width, height, steps, cfg, seed }),
        client_id: crypto.randomUUID()
      })
    });
    const queueResult = await queued.json();
    if (!queueResult.prompt_id) {
      throw new Error(`ComfyUI did not return a prompt_id: ${JSON.stringify(queueResult)}`);
    }

    const outputs = await waitForResult(queueResult.prompt_id);
    const saved = [];
    for (const output of outputs) {
      const imageId = crypto.randomUUID();
      const url = await copyComfyImage(output, project.id, imageId);
      const record = {
        id: imageId,
        url,
        originalFilename: output.filename,
        prompt,
        negativePrompt,
        seed,
        width,
        height,
        steps,
        cfg,
        checkpoint: CHECKPOINT,
        sampler: "euler",
        scheduler: "normal",
        promptId: queueResult.prompt_id,
        createdAt: new Date().toISOString()
      };
      project.images.push(record);
      saved.push(record);
    }
    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    res.json({ promptId: queueResult.prompt_id, seed, images: saved });
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
  console.log(`Stinky AI Studio v0.2: http://127.0.0.1:${PORT}`);
  console.log(`ComfyUI API: ${COMFY_URL}`);
  console.log(`Checkpoint: ${CHECKPOINT}`);
});
