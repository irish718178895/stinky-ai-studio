import {
  normalizeRenderSettings,
  renderProjectVideo
} from "../../services/ffmpeg/video-renderer.js";

export const ffmpegProvider = {
  id: "ffmpeg",
  type: "render",
  name: "FFmpeg",

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
