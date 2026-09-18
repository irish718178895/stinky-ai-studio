import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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
  "facial asymmetry, unstable face, warped eyelid, malformed pupil, " +
  "color shift, hue shift, color flicker, changing white balance, " +
  "changing exposure, saturation shift, background color change, " +
  "lighting drift, changing shadows";


function makeWanWorkflow({
  image,
  prompt,
  negativePrompt,
  seed,
  width,
  height,
  saveContinuation = false
}) {
  const workflow = {
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
        width,
        height,
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

  if (saveContinuation) {
    workflow["62"] = {
      class_type: "ImageFromBatch",
      inputs: {
        image: ["8", 0],
        batch_index: 44,
        length: 1
      }
    };

    workflow["63"] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "Stinky_Wan_Continuation",
        images: ["62", 0]
      }
    };
  }

  return workflow;
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


async function waitForWanOutputs(
  promptId,
  wantContinuation = false,
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

    const videoOutput =
      job?.outputs?.["58"];

    const video =
      videoOutput?.videos?.[0] ||
      videoOutput?.gifs?.[0] ||
      videoOutput?.images?.[0];

    let continuation = null;

    if (wantContinuation) {
      const continuationOutput =
        job?.outputs?.["63"];

      continuation =
        continuationOutput?.images?.[0] || null;
    }

    if (
      video?.filename &&
      (
        !wantContinuation ||
        continuation?.filename
      )
    ) {
      return {
        video,
        continuation
      };
    }

    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );
  }

  throw new Error(
    "Timed out waiting for Wan outputs."
  );
}


async function downloadComfyOutput(
  output,
  destinationPath
) {
  const query = new URLSearchParams({
    filename: output.filename,
    subfolder: output.subfolder || "",
    type: output.type || "output"
  });

  const response = await comfyFetch(
    `/view?${query}`
  );

  if (!response.ok) {
    throw new Error(
      `Could not download Comfy output ${output.filename}`
    );
  }

  await fs.writeFile(
    destinationPath,
    Buffer.from(await response.arrayBuffer())
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


function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      args,
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stderr = "";

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${code}: ${stderr.slice(-4000)}`
        )
      );
    });
  });
}


async function getWanDimensions(
  imagePath
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        imagePath
      ],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", code => {
      if (code !== 0) {
        reject(
          new Error(
            `ffprobe exited with code ${code}: ${stderr}`
          )
        );
        return;
      }

      const match =
        stdout.trim().match(/^(\d+)x(\d+)$/);

      if (!match) {
        reject(
          new Error(
            `Could not determine source image dimensions: ${stdout}`
          )
        );
        return;
      }

      const sourceWidth =
        Number(match[1]);

      const sourceHeight =
        Number(match[2]);

      const portrait =
        sourceHeight > sourceWidth;

      resolve({
        width: portrait ? 544 : 704,
        height: portrait ? 704 : 544,
        orientation:
          portrait ? "portrait" : "landscape"
      });
    });
  });
}


async function generateWanSegment({
  comfyImage,
  prompt,
  negativePrompt,
  seed,
  width,
  height,
  saveContinuation = false
}) {
  const workflow = makeWanWorkflow({
    image: comfyImage,
    prompt,
    negativePrompt,
    seed,
    width,
    height,
    saveContinuation
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

  const queueResult = await queued.json();

  if (!queueResult.prompt_id) {
    throw new Error(
      "ComfyUI did not return a prompt_id: " +
      JSON.stringify(queueResult)
    );
  }

  const outputs = await waitForWanOutputs(
    queueResult.prompt_id,
    saveContinuation
  );

  return {
    promptId: queueResult.prompt_id,
    output: outputs.video,
    continuation: outputs.continuation
  };
}


async function extractLastFrame(
  videoPath,
  framePath
) {
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-sseof",
      "-0.10",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      framePath
    ]
  );
}


async function concatenateWanSegments(
  segmentPaths,
  outputPath,
  duration
) {
  const workDir = path.dirname(outputPath);

  const concatFile = path.join(
    workDir,
    `wan-concat-${crypto.randomUUID()}.txt`
  );

  const escapePath = value =>
    value.replace(/'/g, "'\\''");

  const contents =
    segmentPaths
      .map(
        file =>
          `file '${escapePath(file)}'`
      )
      .join("\n") +
    "\n";

  await fs.writeFile(
    concatFile,
    contents,
    "utf8"
  );

  try {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatFile,
        "-t",
        String(duration),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath
      ]
    );
  } finally {
    await fs.rm(
      concatFile,
      { force: true }
    );
  }
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

  const requestedDurationRaw =
    Number(settings.duration || 2);

  const allowedDurations =
    [2, 5, 10, 30, 60];

  const requestedDuration =
    allowedDurations.includes(
      requestedDurationRaw
    )
      ? requestedDurationRaw
      : 2;

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

  const wanDimensions =
    await getWanDimensions(sourcePath);

  console.log(
    `[Wan] Source orientation: ${wanDimensions.orientation} ` +
    `-> ${wanDimensions.width}x${wanDimensions.height}`
  );

  const suppliedSeed =
    Number(settings.seed);

  const firstSeed =
    Number.isSafeInteger(suppliedSeed) &&
    suppliedSeed > 0
      ? suppliedSeed
      : crypto.randomInt(
          1,
          2_147_483_647
        );


  // ----------------------------------------------------------
  // GOLDEN SINGLE-SEGMENT PATH
  // Keep this behavior unchanged for 2-second generations.
  // ----------------------------------------------------------
  if (requestedDuration <= 2) {
    const comfyImage =
      await uploadImageToComfy(sourcePath);

    const segment =
      await generateWanSegment({
        comfyImage,
        prompt,
        negativePrompt,
        seed: firstSeed,
        width: wanDimensions.width,
        height: wanDimensions.height
      });

    const videoId =
      crypto.randomUUID();

    const copied =
      await copyComfyVideo(
        segment.output,
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
      seed: firstSeed,

      width: wanDimensions.width,
      height: wanDimensions.height,

      sourceFrames: 49,
      interpolation: "FILM x2",
      fps: 48,

      duration: 97 / 48,
      requestedDuration: 2,
      sceneCount: 1,

      model: WAN_MODEL,
      promptId: segment.promptId,

      createdAt: new Date().toISOString()
    };

    project.videos.push(video);
    project.updatedAt =
      new Date().toISOString();

    await writeProjects(projects);

    return {
      promptId: segment.promptId,
      seed: firstSeed,
      video
    };
  }


  // ----------------------------------------------------------
  // LONG-FORM CHAINED MODE
  // ----------------------------------------------------------
  const segmentDuration =
    97 / 48;

  const segmentCount =
    Math.ceil(
      requestedDuration /
      segmentDuration
    );

  const projectDir = path.join(
    PROJECT_FILES_DIR,
    project.id
  );

  await fs.mkdir(
    projectDir,
    { recursive: true }
  );

  const workId =
    crypto.randomUUID();

  const temporaryFiles = [];
  const segmentPaths = [];
  const promptIds = [];
  const seeds = [];

  let currentImagePath =
    sourcePath;

  try {
    for (
      let index = 0;
      index < segmentCount;
      index += 1
    ) {
      console.log(
        `[Wan long-form] Segment ${index + 1}/${segmentCount}`
      );

      const comfyImage =
        await uploadImageToComfy(
          currentImagePath
        );

      const segmentSeed =
        firstSeed;

      seeds.push(segmentSeed);

      const segment =
        await generateWanSegment({
          comfyImage,
          prompt,
          negativePrompt,
          seed: segmentSeed,
          width: wanDimensions.width,
          height: wanDimensions.height,
          saveContinuation:
            index < segmentCount - 1
        });

      promptIds.push(
        segment.promptId
      );

      const segmentId =
        `${workId}-segment-${String(
          index + 1
        ).padStart(2, "0")}`;

      const copied =
        await copyComfyVideo(
          segment.output,
          project.id,
          segmentId
        );

      const segmentPath =
        path.join(
          projectDir,
          copied.filename
        );

      segmentPaths.push(
        segmentPath
      );

      temporaryFiles.push(
        segmentPath
      );

      if (index < segmentCount - 1) {
        if (!segment.continuation?.filename) {
          throw new Error(
            "Wan did not produce a raw continuation frame."
          );
        }

        const framePath =
          path.join(
            projectDir,
            `wan-${workId}-raw-frame-${String(
              index + 1
            ).padStart(2, "0")}.png`
          );

        await downloadComfyOutput(
          segment.continuation,
          framePath
        );

        temporaryFiles.push(
          framePath
        );

        currentImagePath =
          framePath;

        console.log(
          `[Wan long-form] Raw continuation frame saved for segment ${index + 2}`
        );
      }
    }


    // --------------------------------------------------------
    // Join all generated segments into one requested-duration
    // finished MP4.
    // --------------------------------------------------------
    const videoId =
      crypto.randomUUID();

    const storedName =
      `wan-${videoId}.mp4`;

    const storedPath =
      path.join(
        projectDir,
        storedName
      );

    await concatenateWanSegments(
      segmentPaths,
      storedPath,
      requestedDuration
    );

    const stats =
      await fs.stat(storedPath);

    const copied = {
      filename: storedName,
      url:
        `/generated/${encodeURIComponent(project.id)}/` +
        encodeURIComponent(storedName),
      fileSize: stats.size
    };

    if (!Array.isArray(project.videos)) {
      project.videos = [];
    }

    const video = {
      id: videoId,
      ...copied,

      kind: "wan-i2v-long",
      sourceImageId: sourceImage.id,

      prompt,
      negativePrompt,
      seed: firstSeed,
      seeds,

      width: wanDimensions.width,
      height: wanDimensions.height,

      sourceFrames: 49,
      interpolation: "FILM x2",
      fps: 48,

      duration: requestedDuration,
      requestedDuration,
      segmentDuration,
      segmentCount,
      sceneCount: segmentCount,

      model: WAN_MODEL,
      promptId: promptIds[0],
      promptIds,

      createdAt: new Date().toISOString()
    };

    project.videos.push(video);

    project.updatedAt =
      new Date().toISOString();

    await writeProjects(projects);

    return {
      promptId: promptIds[0],
      promptIds,
      seed: firstSeed,
      seeds,
      video
    };

  } finally {
    for (const file of temporaryFiles) {
      await fs.rm(
        file,
        { force: true }
      ).catch(() => {});
    }
  }
}
