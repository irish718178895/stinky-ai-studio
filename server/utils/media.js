import path from "node:path";

export function safeMusicExtension(filename, mimeType) {
  const extension = path.extname(filename || "").toLowerCase();
  const allowed = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
  if (allowed.has(extension)) return extension;
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ".wav";
  if (mimeType === "audio/mp4") return ".m4a";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "audio/flac") return ".flac";
  throw new Error("Unsupported music format. Use MP3, WAV, M4A, AAC, OGG, or FLAC.");
}
