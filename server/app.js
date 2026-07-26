import express from "express";
import {
  PORT, COMFY_URL, CHECKPOINT, OLLAMA_URL, OLLAMA_MODEL,
  PROJECT_FILES_DIR, PUBLIC_DIR, PIPER_COMMAND, PIPER_MODEL
} from "./config.js";
import { ensureStorage } from "./services/project-store.js";
import healthRoutes from "./routes/health.js";
import voiceRoutes from "./routes/voice.js";
import musicRoutes from "./routes/music.js";
import storyboardRoutes from "./routes/storyboard.js";
import projectRoutes from "./routes/projects.js";
import imageRoutes from "./routes/images.js";
import renderRoutes from "./routes/render.js";

const app = express();

app.use(express.json({ limit: "40mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/generated", express.static(PROJECT_FILES_DIR));

app.use(healthRoutes);
app.use(voiceRoutes);
app.use(musicRoutes);
app.use(storyboardRoutes);
app.use(projectRoutes);
app.use(imageRoutes);
app.use(renderRoutes);

await ensureStorage();
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Stinky AI Studio v0.11.4: http://127.0.0.1:${PORT}`);
  console.log(`ComfyUI API: ${COMFY_URL}`);
  console.log(`Checkpoint: ${CHECKPOINT}`);
  console.log(`Ollama: ${OLLAMA_URL} (${OLLAMA_MODEL})`);
  console.log(`Piper: ${PIPER_COMMAND} (${PIPER_MODEL})`);
});
