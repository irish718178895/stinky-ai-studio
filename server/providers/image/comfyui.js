import {
  comfyFetch,
  generateForProject
} from "../../services/comfyui.js";

export const comfyuiProvider = {
  id: "comfyui",
  type: "image",
  name: "ComfyUI",
  version: "1.0",

  capabilities: Object.freeze([
    "txt2img",
    "img2img",
    "batch",
    "seed",
    "negative-prompt"
  ]),

  supports: Object.freeze({
    gpu: true,
    cpu: false,
    local: true,
    remote: true
  }),

  async health() {
    try {
      await comfyFetch("/system_stats");
      return {
        available: true,
        provider: "comfyui"
      };
    } catch (error) {
      return {
        available: false,
        provider: "comfyui",
        error: error.message
      };
    }
  },

  async generate(projects, project, settings, sourceImageId = null) {
    return generateForProject(
      projects,
      project,
      settings,
      sourceImageId
    );
  }
};
