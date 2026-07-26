import fs from "node:fs/promises";
import path from "node:path";
import { PIPER_COMMAND, PIPER_MODEL, PROJECT_FILES_DIR } from "../config.js";
import { runCommandWithInput } from "../utils/process.js";

export async function requirePiper() {
  try { await fs.access(PIPER_COMMAND); }
  catch { throw new Error(`Piper is not installed at ${PIPER_COMMAND}. Run the v0.9 install commands.`); }
  try { await fs.access(PIPER_MODEL); }
  catch { throw new Error(`Piper voice model is missing at ${PIPER_MODEL}. Download the model and its JSON file.`); }
}

export async function synthesizeSceneVoice(project, scene, lengthScale = 1) {
  const narration = String(scene.narration || "").trim();
  if (!narration) throw new Error(`Scene “${scene.title}” has no narration.`);
  await requirePiper();
  const voicesDir = path.join(PROJECT_FILES_DIR, project.id, "voices");
  await fs.mkdir(voicesDir, { recursive: true });
  const filename = `${scene.id}.wav`;
  const outputPath = path.join(voicesDir, filename);
  const scale = Math.min(2, Math.max(0.5, Number(lengthScale) || 1));
  await runCommandWithInput(PIPER_COMMAND, ["--model", PIPER_MODEL, "--output_file", outputPath, "--length_scale", String(scale)], `${narration}\n`);
  scene.voiceUrl = `/generated/${encodeURIComponent(project.id)}/voices/${encodeURIComponent(filename)}`;
  scene.voiceModel = path.basename(PIPER_MODEL);
  scene.voiceLengthScale = scale;
  scene.voiceGeneratedAt = new Date().toISOString();
  scene.updatedAt = scene.voiceGeneratedAt;
  project.updatedAt = scene.voiceGeneratedAt;
  return scene.voiceUrl;
}
