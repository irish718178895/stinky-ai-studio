import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_FILES_DIR, RESOLUTIONS } from "../../config.js";
import { runCommand } from "../../utils/process.js";

async function requireFfmpeg() {
  try { await runCommand("ffmpeg", ["-version"]); }
  catch { throw new Error("FFmpeg is not installed or not in PATH. Install it with: sudo apt install ffmpeg"); }
}

async function nvencAvailable() {
  try {
    const result = await runCommand("ffmpeg", ["-hide_banner", "-encoders"]);
    return result.stdout.includes("h264_nvenc");
  } catch { return false; }
}

export function normalizeRenderSettings(body = {}) {
  const resolution = RESOLUTIONS[body.resolution] ? body.resolution : "720p";
  const fps = [24, 30, 60].includes(Number(body.fps)) ? Number(body.fps) : 30;
  const transition = ["cut", "crossfade", "dip-black"].includes(body.transition) ? body.transition : "crossfade";
  const transitionDuration = Math.min(1.5, Math.max(0.25, Number(body.transitionDuration) || 0.6));
  const encoder = ["auto", "cpu", "nvidia"].includes(body.encoder) ? body.encoder : "auto";
  const includeNarration = body.includeNarration !== false;
  const includeMusic = body.includeMusic === true;
  const musicTrackId = typeof body.musicTrackId === "string" ? body.musicTrackId : null;
  const musicVolume = Math.min(1, Math.max(0, Number(body.musicVolume) || 0.22));
  const duckMusic = body.duckMusic !== false;
  const musicFade = Math.min(5, Math.max(0, Number(body.musicFade) || 1.5));
  return { resolution, fps, transition, transitionDuration, encoder, includeNarration, includeMusic, musicTrackId, musicVolume, duckMusic, musicFade, ...RESOLUTIONS[resolution] };
}

function easeExpression() {
  // Smoothstep: t²(3-2t), giving gentle acceleration and deceleration.
  return "((on/MAX)*(on/MAX)*(3-2*(on/MAX)))";
}

function sceneFilter(scene, frames, width, height, fps) {
  const max = Math.max(1, frames - 1);
  const eased = easeExpression().replaceAll("MAX", String(max));
  const panWidth = Math.round(width * 1.16);
  const standardScale = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`;
  const panScale = `scale=${panWidth}:${height}:force_original_aspect_ratio=increase:flags=lanczos`;

  switch (scene.cameraMovement) {
    case "zoom-out":
      return `${standardScale},zoompan=z='max(1.0,1.14-0.14*${eased})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "pan-left":
      return `${panScale},zoompan=z=1:x='(iw-ow)*(1-${eased})':y='(ih-oh)/2':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "pan-right":
      return `${panScale},zoompan=z=1:x='(iw-ow)*${eased}':y='(ih-oh)/2':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "none":
      return `${standardScale},zoompan=z=1:x='(iw-ow)/2':y='(ih-oh)/2':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
    case "zoom-in":
    default:
      return `${standardScale},zoompan=z='min(1.14,1+0.14*${eased})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`;
  }
}

function parseProgress(text, durationSeconds, callback) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("out_time_ms=")) continue;
    const microseconds = Number(line.slice("out_time_ms=".length));
    if (Number.isFinite(microseconds)) callback(Math.min(1, microseconds / 1_000_000 / Math.max(0.1, durationSeconds)));
  }
}

async function chooseEncoder(requested) {
  const hasNvenc = await nvencAvailable();
  if (requested === "nvidia" && !hasNvenc) throw new Error("NVIDIA NVENC was selected, but FFmpeg does not report h264_nvenc support.");
  if (requested === "nvidia" || (requested === "auto" && hasNvenc)) {
    return { name: "h264_nvenc", args: ["-preset", "p5", "-cq", "21"], label: "NVIDIA NVENC" };
  }
  return { name: "libx264", args: ["-preset", "medium", "-crf", "19"], label: "CPU / libx264" };
}


function safeMusicExtension(filename, mimeType) {
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

async function mixBackgroundMusic({ baseVideoPath, outputPath, musicPath, duration, settings, update }) {
  const fade = Math.min(settings.musicFade, Math.max(0, duration / 3));
  const fadeOutStart = Math.max(0, duration - fade);
  const musicPrep = [
    `volume=${settings.musicVolume}`,
    fade > 0 ? `afade=t=in:st=0:d=${fade}` : null,
    fade > 0 ? `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade}` : null,
    `atrim=0:${duration}`,
    "asetpts=N/SR/TB"
  ].filter(Boolean).join(",");

  let filter;
  if (settings.duckMusic && settings.includeNarration) {
    filter = `[1:a]${musicPrep}[music];[music][0:a]sidechaincompress=threshold=0.025:ratio=10:attack=20:release=650[ducked];[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`;
  } else {
    filter = `[1:a]${musicPrep}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`;
  }

  update({ stage: "Mixing background music", progress: 96 });
  await runCommand("ffmpeg", [
    "-y", "-i", baseVideoPath, "-stream_loop", "-1", "-i", musicPath,
    "-filter_complex", filter,
    "-map", "0:v:0", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    "-t", String(duration), "-movflags", "+faststart", outputPath
  ]);
}

export async function renderProjectVideo(project, settings, update) {
  await requireFfmpeg();
  const scenes = [...(project.scenes || [])].sort((a, b) => a.order - b.order);
  if (!scenes.length) throw new Error("Add at least one scene before rendering.");
  const resolved = scenes.map(scene => ({ scene, image: project.images.find(i => i.id === scene.imageId) }));
  if (resolved.some(item => !item.image)) throw new Error("Every scene must have a selected image before rendering.");

  const encoder = await chooseEncoder(settings.encoder);
  const projectDir = path.join(PROJECT_FILES_DIR, project.id);
  const renderId = crypto.randomUUID();
  const workDir = path.join(projectDir, `.render-${renderId}`);
  const videosDir = path.join(projectDir, "videos");
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(videosDir, { recursive: true });
  const clips = [];
  const durations = [];

  try {
    for (let i = 0; i < resolved.length; i++) {
      const { scene, image } = resolved[i];
      update({ stage: `Rendering scene ${i + 1} of ${resolved.length}`, scene: i + 1 });
      const inputPath = path.join(projectDir, path.basename(new URL(image.url, "http://local").pathname));
      const clip = path.join(workDir, `scene-${String(i + 1).padStart(3, "0")}.mp4`);
      const duration = Math.max(1, Number(scene.duration) || 5);
      const frames = Math.max(1, Math.round(duration * settings.fps));
      const voicePath = settings.includeNarration && scene.voiceUrl
        ? path.join(projectDir, "voices", path.basename(new URL(scene.voiceUrl, "http://local").pathname))
        : null;
      const audioInput = voicePath
        ? ["-i", voicePath]
        : ["-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono"];
      const args = ["-y", "-loop", "1", "-i", inputPath, ...audioInput,
        "-vf", sceneFilter(scene, frames, settings.width, settings.height, settings.fps),
        "-af", `apad,atrim=0:${duration}`,
        "-frames:v", String(frames), "-t", String(duration), "-r", String(settings.fps),
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", encoder.name, ...encoder.args,
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", clip];
      await runCommand("ffmpeg", args, text => parseProgress(text, duration, ratio => {
        update({ progress: Math.round(((i + ratio) / (resolved.length + 1)) * 100) });
      }));
      clips.push(clip);
      durations.push(duration);
    }

    const filename = `stinky-video-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
    const outputPath = path.join(videosDir, filename);
    const baseOutputPath = settings.includeMusic ? path.join(workDir, "video-with-narration.mp4") : outputPath;
    update({ stage: "Joining scenes and applying transitions", progress: Math.round(resolved.length / (resolved.length + 1) * 100) });

    if (settings.transition === "cut" || clips.length === 1) {
      const concatFile = path.join(workDir, "concat.txt");
      await fs.writeFile(concatFile, clips.map(f => `file '${f.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
      await runCommand("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", baseOutputPath]);
    } else {
      const td = Math.min(settings.transitionDuration, ...durations.map(d => Math.max(0.25, d / 3)));
      const inputs = clips.flatMap(clip => ["-i", clip]);
      let filters = "";
      let previousVideo = "0:v";
      let previousAudio = "0:a";
      let cumulative = durations[0];
      for (let i = 1; i < clips.length; i++) {
        const videoOutput = i === clips.length - 1 ? "vout" : `v${i}`;
        const audioOutput = i === clips.length - 1 ? "aout" : `a${i}`;
        const transitionName = settings.transition === "dip-black" ? "fadeblack" : "fade";
        const offset = Math.max(0, cumulative - td * i);
        filters += `[${previousVideo}][${i}:v]xfade=transition=${transitionName}:duration=${td}:offset=${offset.toFixed(3)}[${videoOutput}];`;
        filters += `[${previousAudio}][${i}:a]acrossfade=d=${td}:c1=tri:c2=tri[${audioOutput}];`;
        previousVideo = videoOutput;
        previousAudio = audioOutput;
        cumulative += durations[i];
      }
      filters = filters.replace(/;$/, "");
      const finalDuration = durations.reduce((a, b) => a + b, 0) - td * (clips.length - 1);
      await runCommand("ffmpeg", ["-y", ...inputs, "-filter_complex", filters, "-map", "[vout]", "-map", "[aout]", "-c:v", encoder.name, ...encoder.args, "-c:a", "aac", "-b:a", "160k", "-pix_fmt", "yuv420p", "-r", String(settings.fps), "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", baseOutputPath], text => parseProgress(text, finalDuration, ratio => update({ progress: Math.round(((resolved.length + ratio) / (resolved.length + 1)) * 100) })));
    }

    const duration = durations.reduce((a, b) => a + b, 0) - (settings.transition === "cut" ? 0 : settings.transitionDuration * Math.max(0, clips.length - 1));
    let musicRecord = null;
    if (settings.includeMusic) {
      musicRecord = (project.musicTracks || []).find(track => track.id === settings.musicTrackId);
      if (!musicRecord) throw new Error("Select a background music track before rendering.");
      const musicPath = path.join(projectDir, "music", path.basename(new URL(musicRecord.url, "http://local").pathname));
      await mixBackgroundMusic({ baseVideoPath: baseOutputPath, outputPath, musicPath, duration, settings, update });
    }
    const stat = await fs.stat(outputPath);
    const record = {
      id: renderId, filename,
      url: `/generated/${encodeURIComponent(project.id)}/videos/${encodeURIComponent(filename)}`,
      sceneCount: scenes.length, duration: Math.max(0, Number(duration.toFixed(2))),
      width: settings.width, height: settings.height, fps: settings.fps,
      resolution: settings.resolution, transition: settings.transition,
      encoder: encoder.label, narration: settings.includeNarration,
      music: musicRecord ? { id: musicRecord.id, name: musicRecord.name, volume: settings.musicVolume, ducking: settings.duckMusic } : null,
      fileSize: stat.size,
      createdAt: new Date().toISOString()
    };
    project.videos = Array.isArray(project.videos) ? project.videos : [];
    project.videos.unshift(record);
    project.updatedAt = record.createdAt;
    update({ progress: 100, stage: "Complete" });
    return record;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

