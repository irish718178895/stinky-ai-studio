import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILES_DIR } from "../config.js";
import { readProjects, writeProjects } from "../services/project-store.js";
import { safeMusicExtension } from "../utils/media.js";

const router = express.Router();

router.post("/api/projects/:projectId/music", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const filename = String(req.body.filename || "music").slice(0, 180);
    const mimeType = String(req.body.mimeType || "");
    const encoded = String(req.body.dataBase64 || "");
    if (!encoded) return res.status(400).json({ error: "No audio data was supplied." });
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length || buffer.length > 30 * 1024 * 1024) return res.status(400).json({ error: "Music file must be between 1 byte and 30 MB." });
    const extension = safeMusicExtension(filename, mimeType);
    const id = crypto.randomUUID();
    const musicDir = path.join(PROJECT_FILES_DIR, project.id, "music");
    await fs.mkdir(musicDir, { recursive: true });
    const storedName = `${id}${extension}`;
    await fs.writeFile(path.join(musicDir, storedName), buffer);
    const now = new Date().toISOString();
    const record = { id, name: path.basename(filename), mimeType, fileSize: buffer.length, url: `/generated/${encodeURIComponent(project.id)}/music/${encodeURIComponent(storedName)}`, createdAt: now };
    project.musicTracks = Array.isArray(project.musicTracks) ? project.musicTracks : [];
    project.musicTracks.unshift(record);
    project.updatedAt = now;
    await writeProjects(projects);
    res.status(201).json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/projects/:projectId/music/:musicId", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find(item => item.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found." });
    const index = (project.musicTracks || []).findIndex(item => item.id === req.params.musicId);
    if (index < 0) return res.status(404).json({ error: "Music track not found." });
    const [track] = project.musicTracks.splice(index, 1);
    const storedPath = path.join(PROJECT_FILES_DIR, project.id, "music", path.basename(new URL(track.url, "http://local").pathname));
    await fs.rm(storedPath, { force: true });
    project.updatedAt = new Date().toISOString();
    await writeProjects(projects);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
