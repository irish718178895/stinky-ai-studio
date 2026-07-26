import {
  requirePiper,
  synthesizeSceneVoice
} from "../../services/piper.js";

export const piperProvider = {
  id: "piper",
  type: "voice",
  name: "Piper",

  async health() {
    try {
      await requirePiper();

      return {
        available: true,
        provider: "piper"
      };
    } catch (error) {
      return {
        available: false,
        provider: "piper",
        error: error.message
      };
    }
  },

  async synthesize(project, scene, lengthScale = 1) {
    return synthesizeSceneVoice(
      project,
      scene,
      lengthScale
    );
  }
};
