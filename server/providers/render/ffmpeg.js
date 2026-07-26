import {
  normalizeRenderSettings,
  renderProjectVideo
} from "../../services/ffmpeg/video-renderer.js";

export const ffmpegProvider = {
  id: "ffmpeg",
  type: "render",
  name: "FFmpeg",
  version: "1.0",

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
