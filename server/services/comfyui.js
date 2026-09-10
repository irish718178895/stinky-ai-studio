import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CHECKPOINT,
  COMFY_URL,
  PROJECT_FILES_DIR
} from "../config.js";
import { writeProjects } from "./project-store.js";

function makeWorkflow({
  prompt,
  negativePrompt,
  width,
  height,
  steps,
  cfg,
  seed,
  checkpoint,
  sampler,
  scheduler
}) {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: checkpoint
      }
    },

    "2": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["1", 1]
      }
    },

    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativePrompt,
        clip: ["1", 1]
      }
    },

    "4": {
      class_type: "EmptyLatentImage",
      inputs: {
        width,
        height,
        batch_size: 1
      }
    },

    "5": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0]
      }
    },

    "6": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["5", 0],
        vae: ["1", 2]
      }
    },

    "7": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "Stinky_AI_Studio",
        images: ["6", 0]
      }
    }
  };
}

export async function comfyFetch(route, options = {}) {
  const response = await fetch(`${COMFY_URL}${route}`, options);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `ComfyUI ${response.status}: ${body || response.statusText}`
    );
  }

  return response;
}

async function waitForResult(
  promptId,
  timeoutMs = 20 * 60 * 1000
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const response = await comfyFetch(
      `/history/${encodeURIComponent(promptId)}`
    );

    const history = await response.json();
    const job = history[promptId];

    if (job?.status?.status_str === "error") {
      throw new Error(
        `ComfyUI generation failed: ${JSON.stringify(
          job.status.messages || []
        )}`
      );
    }

    const images = [];

    for (const output of Object.values(job?.outputs || {})) {
      for (const image of output.images || []) {
        images.push(image);
      }
    }

    if (images.length) {
      return images;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for ComfyUI to finish.");
}

async function copyComfyImage(
  image,
  projectId,
  imageId
) {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || "",
    type: image.type || "output"
  });

  const response = await comfyFetch(`/view?${query}`);

  const extension = path.extname(image.filename) || ".png";
  const projectDir = path.join(
    PROJECT_FILES_DIR,
    projectId
  );

  await fs.mkdir(projectDir, {
    recursive: true
  });

  const storedName = `${imageId}${extension}`;

  await fs.writeFile(
    path.join(projectDir, storedName),
    Buffer.from(await response.arrayBuffer())
  );

  return (
    `/generated/${encodeURIComponent(projectId)}/` +
    encodeURIComponent(storedName)
  );
}

function normalizeNumber(
  value,
  fallback,
  minimum,
  maximum
) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(minimum, parsed)
  );
}

export async function generateForProject(
  projects,
  project,
  settings = {},
  sourceImageId = null
) {
  const prompt = String(settings.prompt || "").trim();

  const negativePrompt = String(
    settings.negativePrompt || ""
  ).trim();

  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  const checkpoint = String(
    settings.checkpoint || CHECKPOINT
  ).trim();

  const sampler = String(
    settings.sampler || "euler"
  ).trim();

  const scheduler = String(
    settings.scheduler || "normal"
  ).trim();

  if (!checkpoint) {
    throw new Error("A ComfyUI checkpoint is required.");
  }

  if (!sampler) {
    throw new Error("A ComfyUI sampler is required.");
  }

  if (!scheduler) {
    throw new Error("A ComfyUI scheduler is required.");
  }

  const width = Math.round(
    normalizeNumber(settings.width, 768, 256, 1024)
  );

  const height = Math.round(
    normalizeNumber(settings.height, 768, 256, 1024)
  );

  const steps = Math.round(
    normalizeNumber(settings.steps, 20, 1, 100)
  );

  const cfg = normalizeNumber(
    settings.cfg,
    7,
    1,
    30
  );

  const suppliedSeed = Number(settings.seed);

  const seed =
    Number.isSafeInteger(suppliedSeed) &&
    suppliedSeed > 0
      ? suppliedSeed
      : crypto.randomInt(1, 2_147_483_647);

  const workflow = makeWorkflow({
    prompt,
    negativePrompt,
    width,
    height,
    steps,
    cfg,
    seed,
    checkpoint,
    sampler,
    scheduler
  });

  const queued = await comfyFetch("/prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: workflow,
      client_id: crypto.randomUUID()
    })
  });

  const queueResult = await queued.json();

  if (!queueResult.prompt_id) {
    throw new Error(
      `ComfyUI did not return a prompt_id: ${JSON.stringify(
        queueResult
      )}`
    );
  }

  const outputs = await waitForResult(
    queueResult.prompt_id
  );

  const saved = [];

  if (!Array.isArray(project.images)) {
    project.images = [];
  }

  for (const output of outputs) {
    const imageId = crypto.randomUUID();

    const url = await copyComfyImage(
      output,
      project.id,
      imageId
    );

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
      checkpoint,
      sampler,
      scheduler,
      promptId: queueResult.prompt_id,
      sourceImageId,
      createdAt: new Date().toISOString()
    };

    project.images.push(record);
    saved.push(record);
  }

  project.updatedAt = new Date().toISOString();

  await writeProjects(projects);

  return {
    promptId: queueResult.prompt_id,
    seed,
    images: saved
  };
}
