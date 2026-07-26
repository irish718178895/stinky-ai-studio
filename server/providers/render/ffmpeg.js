import {
  normalizeRenderSettings,
  renderProjectVideo
} from "../../services/ffmpeg/video-renderer.js";

export const ffmpegProvider = {
  id: "ffmpeg",
  type: "render",
  name: "FFmpeg",
  version: "1.0",

settingsSchema: [
  {
    key: "encoder",
    label: "Encoder",
    type: "text",
    default: "nvenc"
  },
  {
    key: "resolution",
    label: "Resolution",
    type: "text",
    default: "1080p"
  },
  {
    key: "fps",
    label: "FPS",
    type: "number",
    default: 60,
    min: 1,
    max: 120,
    step: 1
  }
],

  capabilities: Object.freeze([
    "video-render",
    "music",
    "transitions",
    "encoding"
  ]),

  supports: Object.freeze({
    gpu: true,
    cpu: true,
    local: true,
    remote: false
  }),

  normalizeSettings(body = {}) {
    return normalizeRenderSettings(body);
  },

  async render(project, settings, update) {
    return renderProjectVideo(
      project,
      settings,
      update
    );
  }
};
