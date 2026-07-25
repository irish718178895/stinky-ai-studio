import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { generateStoryboard } from "./modules/storyboard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const COMFY_URL = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const CHECKPOINT = process.env.CHECKPOINT || "dreamshaper_8.safetensors";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const DATA_DIR = path.join(__dirname, "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const PROJECT_FILES_DIR = path.join(DATA_DIR, "projects");
const renderJobs = new Map();
const imageJobs = new Map();
const RESOLUTIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 }
};

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
  return Array.isArray(parsed) ? parsed.map(normalizeProject) : [];
}

async function writeProjects(projects) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${PROJECTS_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  await fs.rename(temp, PROJECTS_FILE);
}

function normalizeProject(project) {
  const images = Array.isArray(project.images) ? project.images : [];
  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  return {
    ...project,
    images,
    videos: Array.isArray(project.videos) ? project.videos : [],
    scenes: scenes
      .map((scene, index) => ({
        id: scene.id || crypto.randomUUID(),
        title: String(scene.title || `Scene ${index + 1}`).slice(0, 100),
        description: String(scene.description || "").slice(0, 500),
        imagePrompt: String(scene.imagePrompt || scene.prompt || scene.description || "").slice(0, 4000),
        narration: String(scene.narration || "").slice(0, 2000),
        duration: Math.min(60, Math.max(1, Number(scene.duration) || 5)),
        cameraMovement: ["none", "zoom-in", "zoom-out", "pan-left", "pan-right"].includes(scene.cameraMovement)
          ? scene.cameraMovement
          : "zoom-in",
        imageId: images.some(image => image.id === scene.imageId) ? scene.imageId : null,
        order: Number.isInteger(scene.order) ? scene.order : index,
        createdAt: scene.createdAt || new Date().toISOString(),
        updatedAt: scene.updatedAt || new Date().toISOString()
      }))
      .sort((a, b) => a.order - b.order)
      .map((scene, index) => ({ ...scene, order: index }))
  };
}

function publicProject(project) {
  const normalized = normalizeProject(project);
  return {
    ...normalized,
    images: [...normalized.images].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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


function runCommand(command, args, onProgress = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      const text = chunk.toString();
      stdout += text;
      if (onProgress) onProgress(text);
    });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-6000)}`));
    });
  });
}

async function requireFfmpeg() {
  try { await runCommand("ffmpeg", ["-version"]); }
  catch { throw new Error("FFmpeg is not installed or not in PATH. Install it with: sudo apt install ffmpeg"); }
}

async function nvencAvailable() {
  try {
    const result = await runCommand("ffmpeg", ["-hide_banner", "-encoders"]);
    return result.stdout.includes("h264_nvenc");
  } catch { return false; }
}

function normalizeRenderSettings(body = {}) {
  const resolution = RESOLUTIONS[body.resolution] ? body.resolution : "720p";
  const fps = [24, 30, 60].includes(Number(body.fps)) ? Number(body.fps) : 30;
  const transition = ["cut", "crossfade", "dip-black"].includes(body.transition) ? body.transition : "crossfade";
  const transitionDuration = Math.min(1.5, Math.max(0.25, Number(body.transitionDuration) || 0.6));
  const encoder = ["auto", "cpu", "nvidia"].includes(body.encoder) ? body.encoder : "auto";
  return { resolution, fps, transition, transitionDuration, encoder, ...RESOLUTIONS[resolution] };
}

function easeExpression() {
  // Smoothstep: t²(3-2t), giving gentle acceleration and deceleration.
  return "((on/MAX)*(on/MAX)*(3-2*(on/MAX)))";
}

function sceneFilter(scene, frames, width, height, fps) {
  const max = Math.max(1, frames - 1);
  const eased = easeExpression().replaceAll("MAX", String(max));
  const panWidth = Math.round(width * 1.16);
  const standardScale = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`;
  const panScale = `scale=${panWidth}:${height}:force_original_aspect_ratio=increase:flags=lanczos`;

  switch (scene.cameraMovement) {
    case "zoom-out":
      return `${standardScale},zoompan=z='max(1.0,1.14-0.14*${eased})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "pan-left":
      return `${panScale},zoompan=z=1:x='(iw-ow)*(1-${eased})':y='(ih-oh)/2':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "pan-right":
      return `${panScale},zoompan=z=1:x='(iw-ow)*${eased}':y='(ih-oh)/2':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "none":
      return `${standardScale},zoompan=z=1:x='(iw-ow)/2':y='(ih-oh)/2':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "zoom-in":
    default:
      return `${standardScale},zoompan=z='min(1.14,1+0.14*${eased})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
  }
}

function parseProgress(text, durationSeconds, callback) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("out_time_ms=")) continue;
    const microseconds = Number(line.slice("out_time_ms=".length));
    if (Number.isFinite(microseconds)) callback(Math.min(1, microseconds / 1_000_000 / Math.max(0.1, durationSeconds)));
  }
}

async function chooseEncoder(requested) {
  const hasNvenc = await nvencAvailable();
  if (requested === "nvidia" && !hasNvenc) throw new Error("NVIDIA NVENC was selected, but FFmpeg does not report h264_nvenc support.");
  if (requested === "nvidia" || (requested === "auto" && hasNvenc)) {
    return { name: "h264_nvenc", args: ["-preset", "p5", "-cq", "21"], label: "NVIDIA NVENC" };
  }
  return { name: "libx264", args: ["-preset", "medium", "-crf", "19"], label: "CPU / libx264" };
}

async function renderProjectVideo(project, settings, update) {
  await requireFfmpeg();
  const scenes = [...(project.scenes || [])].sort((a, b) => a.order - b.order);
  if (!scenes.length) throw new Error("Add at least one scene before rendering.");
  const resolved = scenes.map(scene => ({ scene, image: project.images.find(i => i.id === scene.imageId) }));
  if (resolved.some(item => !item.image)) throw new Error("Every scene must have a selected image before rendering.");

  const encoder = await chooseEncoder(settings.encoder);
  const projectDir = path.join(PROJECT_FILES_DIR, project.id);
  const renderId = crypto.randomUUID();
  const workDir = path.join(projectDir, `.render-${renderId}`);
  const videosDir = path.join(projectDir, "videos");
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(videosDir, { recursive: true });
  const clips = [];
  const durations = [];

  try {
    for (let i = 0; i < resolved.length; i++) {
      const { scene, image } = resolved[i];
      update({ stage: `Rendering scene ${i + 1} of ${resolved.length}`, scene: i + 1 });
      const inputPath = path.join(projectDir, path.basename(new URL(image.url, "http://local").pathname));
      const clip = path.join(workDir, `scene-${String(i + 1).padStart(3, "0")}.mp4`);
      const duration = Math.max(1, Number(scene.duration) || 5);
      const frames = Math.max(1, Math.round(duration * settings.fps));
      const args = ["-y", "-loop", "1", "-i", inputPath, "-vf", sceneFilter(scene, frames, settings.width, settings.height, settings.fps), "-frames:v", String(frames), "-r", String(settings.fps), "-c:v", encoder.name, ...encoder.args, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", clip];
      await runCommand("ffmpeg", args, text => parseProgress(text, duration, ratio => {
        update({ progress: Math.round(((i + ratio) / (resolved.length + 1)) * 100) });
      }));
      clips.push(clip);
      durations.push(duration);
    }

    const filename = `stinky-video-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
    const outputPath = path.join(videosDir, filename);
    update({ stage: "Joining scenes and applying transitions", progress: Math.round(resolved.length / (resolved.length + 1) * 100) });

    if (settings.transition === "cut" || clips.length === 1) {
      const concatFile = path.join(workDir, "concat.txt");
      await fs.writeFile(concatFile, clips.map(f => `file '${f.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
      await runCommand("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", outputPath]);
    } else {
      const td = Math.min(settings.transitionDuration, ...durations.map(d => Math.max(0.25, d / 3)));
      const inputs = clips.flatMap(clip => ["-i", clip]);
      let filters = "";
      let previous = "0:v";
      let cumulative = durations[0];
      for (let i = 1; i < clips.length; i++) {
        const output = i === clips.length - 1 ? "vout" : `v${i}`;
        const transitionName = settings.transition === "dip-black" ? "fadeblack" : "fade";
        const offset = Math.max(0, cumulative - td * i);
        filters += `[${previous}][${i}:v]xfade=transition=${transitionName}:duration=${td}:offset=${offset.toFixed(3)}[${output}];`;
        previous = output;
        cumulative += durations[i];
      }
      filters = filters.replace(/;$/, "");
      const finalDuration = durations.reduce((a, b) => a + b, 0) - td * (clips.length - 1);
      await runCommand("ffmpeg", ["-y", ...inputs, "-filter_complex", filters, "-map", "[vout]", "-c:v", encoder.name, ...encoder.args, "-pix_fmt", "yuv420p", "-r", String(settings.fps), "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outputPath], text => parseProgress(text, finalDuration, ratio => update({ progress: Math.round(((resolved.length + ratio) / (resolved.length + 1)) * 100) })));
    }

    const stat = await fs.stat(outputPath);
    const duration = durations.reduce((a, b) => a + b, 0) - (settings.transition === "cut" ? 0 : settings.transitionDuration * Math.max(0, clips.length - 1));
    const record = {
      id: renderId, filename,
      url: `/generated/${encodeURIComponent(project.id)}/videos/${encodeURIComponent(filename)}`,
      sceneCount: scenes.length, duration: Math.max(0, Number(duration.toFixed(2))),
      width: settings.width, height: settings.height, fps: settings.fps,
      resolution: settings.resolution, transition: settings.transition,
      encoder: encoder.label, fileSize: stat.size,
      createdAt: new Date().toISOString()
    };
    project.videos = Array.isArray(project.videos) ? project.videos : [];
    project.videos.unshift(record);
    project.updatedAt = record.createdAt;
    update({ progress: 100, stage: "Complete" });
    return record;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    const response = await comfyFetch("/system_stats");
    res.json({ ok: true, comfyUrl: COMFY_URL, checkpoint: CHECKPOINT, stats: await response.json() });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
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

async function generateForProject(projects, project, settings, sourceImageId = null) {
  const prompt = String(settings.prompt || "").trim();
  const negativePrompt = String(settings.negativePrompt || "").trim();
  const width = Math.min(768, Math.max(256, Number(settings.width) || 512));
  const height = Math.min(768, Math.max(256, Number(settings.height) || 512));
  const steps = Math.min(40, Math.max(1, Number(settings.steps) || 20));
  const cfg = Math.min(15, Math.max(1, Number(settings.cfg) || 7));
  const suppliedSeed = Number(settings.seed);
  const seed = Number.isSafeInteger(suppliedSeed) && suppliedSeed > 0
    ? suppliedSeed
    : crypto.randomInt(1, 2_147_483_647);

  if (!prompt) throw new Error("Prompt is required.");

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
      sourceImageId,
      createdAt: new Date().toISOString()
    };
    project.images.push(record);
    saved.push(record);
  }
  project.updatedAt = new Date().toISOString();
  await writeProjects(projects);
  return { promptId: queueResult.prompt_id, seed, images: saved };
}

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
    if (req.body.narration !== undefined) scene.narration = String(req.body.narration).trim().slice(0, 2000);
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
  console.log(`Stinky AI Studio v0.8: http://127.0.0.1:${PORT}`);
  console.log(`ComfyUI API: ${COMFY_URL}`);
  console.log(`Checkpoint: ${CHECKPOINT}`);
  console.log(`Ollama: ${OLLAMA_URL} (${OLLAMA_MODEL})`);
});
