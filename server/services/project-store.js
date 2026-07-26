import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DATA_DIR, PROJECTS_FILE, PROJECT_FILES_DIR } from "../config.js";
import { normalizeProviderManifest } from "../providers/manager.js";

export async function ensureStorage() {
  await fs.mkdir(PROJECT_FILES_DIR, { recursive: true });
  try {
    await fs.access(PROJECTS_FILE);
  } catch {
    await writeProjects([]);
  }
}

export async function readProjects() {
  await ensureStorage();
  const raw = await fs.readFile(PROJECTS_FILE, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed.map(normalizeProject) : [];
}

export async function writeProjects(projects) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${PROJECTS_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  await fs.rename(temp, PROJECTS_FILE);
}

export function normalizeProject(project) {
  const images = Array.isArray(project.images) ? project.images : [];
  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  return {
    ...project,
    providers: normalizeProviderManifest(project.providers),
    images,
    videos: Array.isArray(project.videos) ? project.videos : [],
    musicTracks: Array.isArray(project.musicTracks) ? project.musicTracks : [],
    scenes: scenes
      .map((scene, index) => ({
        id: scene.id || crypto.randomUUID(),
        title: String(scene.title || `Scene ${index + 1}`).slice(0, 100),
        description: String(scene.description || "").slice(0, 500),
        imagePrompt: String(scene.imagePrompt || scene.prompt || scene.description || "").slice(0, 4000),
        narration: String(scene.narration || "").slice(0, 2000),
        voiceUrl: scene.voiceUrl || null,
        voiceModel: scene.voiceModel || null,
        voiceLengthScale: Math.min(2, Math.max(0.5, Number(scene.voiceLengthScale) || 1)),
        voiceGeneratedAt: scene.voiceGeneratedAt || null,
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

export function publicProject(project) {
  const normalized = normalizeProject(project);
  return {
    ...normalized,
    images: [...normalized.images].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  };
}
