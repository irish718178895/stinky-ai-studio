import fs from "node:fs/promises";
import path from "node:path";
import {
  PIPER_COMMAND,
  PIPER_MODEL,
  PIPER_VOICES_DIR,
  PROJECT_FILES_DIR
} from "../config.js";
import { runCommandWithInput } from "../utils/process.js";

function voiceIdFromPath(modelPath) {
  return path.basename(modelPath, ".onnx");
}

function normalizeLengthScale(value) {
  return Math.min(2, Math.max(0.5, Number(value) || 1));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listPiperVoices() {
  let entries = [];

  try {
    entries = await fs.readdir(PIPER_VOICES_DIR, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const voices = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".onnx")) {
      continue;
    }

    const modelPath = path.join(PIPER_VOICES_DIR, entry.name);
    const configPath = `${modelPath}.json`;

    voices.push({
      id: voiceIdFromPath(modelPath),
      modelPath,
      configPath,
      hasConfig: await fileExists(configPath)
    });
  }

  if (await fileExists(PIPER_MODEL)) {
    const configuredVoiceId = voiceIdFromPath(PIPER_MODEL);

    if (!voices.some(voice => voice.id === configuredVoiceId)) {
      voices.push({
        id: configuredVoiceId,
        modelPath: PIPER_MODEL,
        configPath: `${PIPER_MODEL}.json`,
        hasConfig: await fileExists(`${PIPER_MODEL}.json`)
      });
    }
  }

  return voices.sort((a, b) => a.id.localeCompare(b.id));
}

export async function resolvePiperVoice(voice) {
  const requestedVoice = String(voice || "").trim();

  if (!requestedVoice) {
    return {
      id: voiceIdFromPath(PIPER_MODEL),
      modelPath: PIPER_MODEL
    };
  }

  const voices = await listPiperVoices();
  const match = voices.find(item => item.id === requestedVoice);

  if (!match) {
    throw new Error(
      `Piper voice "${requestedVoice}" is not installed in ${PIPER_VOICES_DIR}.`
    );
  }

  return match;
}

export async function requirePiper(modelPath = PIPER_MODEL) {
  try {
    await fs.access(PIPER_COMMAND);
  } catch {
    throw new Error(
      `Piper is not installed at ${PIPER_COMMAND}. Run the v0.9 install commands.`
    );
  }

  try {
    await fs.access(modelPath);
  } catch {
    throw new Error(
      `Piper voice model is missing at ${modelPath}. Download the model and its JSON file.`
    );
  }
}

export async function synthesizeSceneVoice(project, scene, settings = {}) {
  const narration = String(scene.narration || "").trim();

  if (!narration) {
    throw new Error(`Scene “${scene.title}” has no narration.`);
  }

  const normalizedSettings =
    typeof settings === "number"
      ? { lengthScale: settings }
      : (settings || {});

  const selectedVoice = await resolvePiperVoice(normalizedSettings.voice);
  await requirePiper(selectedVoice.modelPath);

  const voicesDir = path.join(PROJECT_FILES_DIR, project.id, "voices");
  await fs.mkdir(voicesDir, { recursive: true });

  const filename = `${scene.id}.wav`;
  const outputPath = path.join(voicesDir, filename);
  const scale = normalizeLengthScale(normalizedSettings.lengthScale);

  await runCommandWithInput(
    PIPER_COMMAND,
    [
      "--model",
      selectedVoice.modelPath,
      "--output_file",
      outputPath,
      "--length_scale",
      String(scale)
    ],
    `${narration}\n`
  );

  scene.voiceUrl = `/generated/${encodeURIComponent(project.id)}/voices/${encodeURIComponent(filename)}`;
  scene.voiceModel = path.basename(selectedVoice.modelPath);
  scene.voiceProvider = "piper";
  scene.voiceLengthScale = scale;
  scene.voiceGeneratedAt = new Date().toISOString();
  scene.updatedAt = scene.voiceGeneratedAt;
  project.updatedAt = scene.voiceGeneratedAt;

  return scene.voiceUrl;
}
