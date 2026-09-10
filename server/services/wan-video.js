import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  COMFY_URL,
  PROJECT_FILES_DIR
} from "../config.js";

import { comfyFetch } from "./comfyui.js";
import { writeProjects } from "./project-store.js";


const WAN_MODEL =
  "wan2.2_ti2v_5B_fp16.safetensors";

const WAN_CLIP =
  "umt5_xxl_fp8_e4m3fn_scaled.safetensors";

const WAN_VAE =
  "wan2.2_vae.safetensors";

const FILM_MODEL =
  "film_net_fp16.safetensors";


const DEFAULT_NEGATIVE_PROMPT =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，" +
  "整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，" +
  "画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，" +
  "手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走, " +
  "deformed eye, asymmetrical eyes, distorted eye, warped eye, lazy eye, " +
  "misaligned eyes, extra eye, missing eye, melted face, distorted face, " +
  "facial asymmetry, unstable face, warped eyelid, malformed pupil";


function makeWanWorkflow({
  image,
  prompt,
  negativePrompt,
  seed
}) {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 20,
        cfg: 5,
        sampler_name: "uni_pc",
        scheduler: "simple",
        denoise: 1,
        model: ["48", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["55", 0]
      }
    },

    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["38", 0]
      }
    },

    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativePrompt,
        clip: ["38", 0]
      }
    },

    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["39", 0]
      }
    },

    "37": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: WAN_MODEL,
        weight_dtype: "default"
      }
    },

    "38": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: WAN_CLIP,
        type: "wan",
        device: "default"
      }
    },

    "39": {
      class_type: "VAELoader",
      inputs: {
        vae_name: WAN_VAE
      }
    },

    "48": {
      class_type: "ModelSamplingSD3",
      inputs: {
        shift: 8,
        model: ["37", 0]
      }
    },

    "55": {
      class_type: "Wan22ImageToVideoLatent",
      inputs: {
        width: 640,
        height: 480,
        length: 49,
        batch_size: 1,
        vae: ["39", 0],
        start_image: ["56", 0]
      }
    },

    "56": {
      class_type: "LoadImage",
      inputs: {
        image
      }
    },

    "57": {
      class_type: "CreateVideo",
      inputs: {
        fps: 48,
        bit_depth: 8,
        images: ["61", 0]
      }
    },

    "58": {
      class_type: "SaveVideo",
      inputs: {
        filename_prefix: "video/Stinky_Wan",
        format: "auto",
        codec: "auto",
        video: ["57", 0]
      }
    },

    "60": {
      class_type: "FrameInterpolationModelLoader",
      inputs: {
        model_name: FILM_MODEL
      }
    },

    "61": {
      class_type: "FrameInterpolate",
      inputs: {
        multiplier: 2,
        interp_model: ["60", 0],
        images: ["8", 0]
      }
    }
  };
}


async function uploadImageToComfy(filePath) {
  const data = await fs.readFile(filePath);

  const form = new FormData();

  form.append(
    "image",
    new Blob([data]),
    path.basename(filePath)
  );

  form.append("overwrite", "true");

  const response = await comfyFetch(
    "/upload/image",
    {
      method: "POST",
      body: form
    }
  );

  const result = await response.json();

  if (!result.name) {
    throw new Error(
      `ComfyUI image upload failed: ${JSON.stringify(result)}`
    );
  }

  return result.subfolder
    ? `${result.subfolder}/${result.name}`
    : result.name;
}


async function waitForVideo(
  promptId,
  timeoutMs = 30 * 60 * 1000
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
        `Wan video generation failed: ${JSON.stringify(
          job.status.messages || []
        )}`
      );
    }

    for (const output of Object.values(
      job?.outputs || {}
    )) {
      const candidates = [
        ...(output.videos || []),
        ...(output.gifs || []),
        ...(output.images || [])
      ];

      for (const item of candidates) {
        if (item?.filename) {
          return item;
        }
      }
    }

    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );
  }

  throw new Error(
    "Timed out waiting for Wan video generation."
  );
}


async function copyComfyVideo(
  output,
  projectId,
  videoId
) {
  const query = new URLSearchParams({
    filename: output.filename,
    subfolder: output.subfolder || "",
    type: output.type || "output"
  });

  const response = await comfyFetch(
    `/view?${query}`
  );

  const extension =
    path.extname(output.filename) || ".mp4";

  const projectDir = path.join(
    PROJECT_FILES_DIR,
    projectId
  );

  await fs.mkdir(projectDir, {
    recursive: true
  });

  const storedName =
    `wan-${videoId}${extension}`;

  const storedPath = path.join(
    projectDir,
    storedName
  );

  await fs.writeFile(
    storedPath,
    Buffer.from(await response.arrayBuffer())
  );

  const stats = await fs.stat(storedPath);

  return {
    filename: storedName,
    url:
      `/generated/${encodeURIComponent(projectId)}/` +
      encodeURIComponent(storedName),
    fileSize: stats.size
  };
}


export async function generateWanVideo(
  projects,
  project,
  sourceImage,
  settings = {}
) {
  if (!sourceImage?.url) {
    throw new Error(
      "A source image is required."
    );
  }

  const prompt =
    String(settings.prompt || "").trim();

  if (!prompt) {
    throw new Error(
      "A motion prompt is required."
    );
  }

  const negativePrompt =
    String(
      settings.negativePrompt ||
      DEFAULT_NEGATIVE_PROMPT
    ).trim();

  const sourceFilename = path.basename(
    new URL(
      sourceImage.url,
      "http://local"
    ).pathname
  );

  const sourcePath = path.join(
    PROJECT_FILES_DIR,
    project.id,
    sourceFilename
  );

  const comfyImage =
    await uploadImageToComfy(sourcePath);

  const suppliedSeed =
    Number(settings.seed);

  const seed =
    Number.isSafeInteger(suppliedSeed) &&
    suppliedSeed > 0
      ? suppliedSeed
      : crypto.randomInt(
          1,
          2_147_483_647
        );

  const workflow = makeWanWorkflow({
    image: comfyImage,
    prompt,
    negativePrompt,
    seed
  });

  const queued = await comfyFetch(
    "/prompt",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: workflow,
        client_id: crypto.randomUUID()
      })
    }
  );

  const queueResult =
    await queued.json();

  if (!queueResult.prompt_id) {
    throw new Error(
      "ComfyUI did not return a prompt_id: " +
      JSON.stringify(queueResult)
    );
  }

  const output = await waitForVideo(
    queueResult.prompt_id
  );

  const videoId =
    crypto.randomUUID();

  const copied =
    await copyComfyVideo(
      output,
      project.id,
      videoId
    );

  if (!Array.isArray(project.videos)) {
    project.videos = [];
  }

  const video = {
    id: videoId,
    ...copied,

    kind: "wan-i2v",
    sourceImageId: sourceImage.id,

    prompt,
    negativePrompt,
    seed,

    width: 640,
    height: 480,

    sourceFrames: 49,
    interpolation: "FILM x2",
    fps: 48,

    duration: 97 / 48,
    sceneCount: 1,

    model: WAN_MODEL,
    promptId: queueResult.prompt_id,

    createdAt: new Date().toISOString()
  };

  project.videos.push(video);
  project.updatedAt =
    new Date().toISOString();

  await writeProjects(projects);

  return {
    promptId: queueResult.prompt_id,
    seed,
    video
  };
}
