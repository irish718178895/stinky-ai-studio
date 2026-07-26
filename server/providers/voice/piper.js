import {
  listPiperVoices,
  requirePiper,
  synthesizeSceneVoice
} from "../../services/piper.js";

function removeUndefinedValues(values = {}) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );
}

export const piperProvider = {
  id: "piper",
  type: "voice",
  name: "Piper",
  version: "1.0",

  settingsSchema: [
    {
      key: "voice",
      label: "Voice",
      type: "select",
      default: "en_US-lessac-medium",
      options: []
    },
    {
      key: "lengthScale",
      label: "Speed",
      type: "number",
      default: 1,
      min: 0.5,
      max: 2,
      step: 0.1
    }
  ],

  capabilities: Object.freeze([
    "tts",
    "batch"
  ]),

  supports: Object.freeze({
    gpu: false,
    cpu: true,
    local: true,
    remote: false
  }),

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

  async metadata() {
    const installedVoices = await listPiperVoices();
    const voices = installedVoices.map(voice => voice.id);

    return {
      voices,
      voiceDetails: installedVoices.map(voice => ({
        id: voice.id,
        hasConfig: voice.hasConfig
      })),
      settings: {
        voice: {
          type: "select",
          options: voices
        }
      }
    };
  },

  async synthesize(project, scene, settings = {}) {
    const projectSettings = {
      ...(project.providerSettings?.[this.id] || {})
    };

    const requestSettings =
      typeof settings === "number"
        ? { lengthScale: settings }
        : removeUndefinedValues(settings);

    return synthesizeSceneVoice(
      project,
      scene,
      {
        ...projectSettings,
        ...requestSettings
      }
    );
  }
};
