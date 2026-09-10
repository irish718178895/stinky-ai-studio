import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
export const SERVER_DIR = path.dirname(__filename);
export const ROOT_DIR = path.dirname(SERVER_DIR);

export const PORT = Number(process.env.PORT || 3000);
export const COMFY_URL = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
export const CHECKPOINT = process.env.CHECKPOINT || "dreamshaper_8.safetensors";
export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
export const PROJECT_FILES_DIR = path.join(DATA_DIR, "projects");
export const PUBLIC_DIR = path.join(ROOT_DIR, "public");
export const PIPER_COMMAND = process.env.PIPER_COMMAND || path.join(ROOT_DIR, ".venv-piper", "bin", "piper");
export const PIPER_VOICES_DIR = process.env.PIPER_VOICES_DIR || path.join(ROOT_DIR, "voices");
export const PIPER_MODEL = process.env.PIPER_MODEL || path.join(PIPER_VOICES_DIR, "en_US-lessac-medium.onnx");

export const ECHOMIMIC_DIR =
  process.env.ECHOMIMIC_DIR ||
  path.join(process.env.HOME || "", "echomimic_v3");

export const ECHOMIMIC_PYTHON =
  process.env.ECHOMIMIC_PYTHON ||
  path.join(
    process.env.HOME || "",
    "miniconda3",
    "envs",
    "EchoMimic",
    "bin",
    "python"
  );
export const RESOLUTIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 }
};
