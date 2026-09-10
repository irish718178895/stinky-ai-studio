import fs from "node:fs/promises";
import {
  ECHOMIMIC_DIR,
  ECHOMIMIC_PYTHON
} from "../../config.js";

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export const echomimicProvider = {
  id: "echomimic",
  type: "animation",
  name: "EchoMimicV3",
  version: "3",

  settingsSchema: [
    {
      key: "sampleSize",
      label: "Generation Size",
      type: "select",
      default: "512",
      options: [
        { value: "384", label: "384 × 384" },
        { value: "512", label: "512 × 512" }
      ]
    },
    {
      key: "steps",
      label: "Inference Steps",
      type: "number",
      default: 8,
      min: 1,
      max: 25,
      step: 1
    },
    {
      key: "audioGuidance",
      label: "Audio Guidance",
      type: "number",
      default: 2.0,
      min: 1,
      max: 4,
      step: 0.1
    },
    {
      key: "fps",
      label: "FPS",
      type: "number",
      default: 25,
      min: 12,
      max: 30,
      step: 1
    }
  ],

  capabilities: Object.freeze([
    "image-to-video",
    "audio-driven",
    "lip-sync",
    "talking-head"
  ]),

  supports: Object.freeze({
    gpu: true,
    cpu: false,
    local: true,
    remote: false
  }),

  async health() {
    const [
      repo,
      python,
      inferenceScript
    ] = await Promise.all([
      exists(ECHOMIMIC_DIR),
      exists(ECHOMIMIC_PYTHON),
      exists(`${ECHOMIMIC_DIR}/infer_flash.py`)
    ]);

    const available = repo && python && inferenceScript;

    return {
      available,
      provider: "echomimic",
      repo,
      python,
      inferenceScript,
      repoPath: ECHOMIMIC_DIR,
      pythonPath: ECHOMIMIC_PYTHON,
      message: available
        ? "EchoMimicV3 installation detected."
        : "EchoMimicV3 installation is incomplete."
    };
  }
};
