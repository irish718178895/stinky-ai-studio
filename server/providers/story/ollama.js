import { generateStoryboard } from "../../../modules/storyboard.js";
import { OLLAMA_URL, OLLAMA_MODEL } from "../../config.js";

function normalizeModels(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];

  return models
    .map(model => String(model?.name || model?.model || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export const ollamaProvider = {
  id: "ollama",
  type: "story",
  name: "Ollama",
  version: "1.0",

  settingsSchema: [
    {
      key: "model",
      label: "Model",
      type: "select",
      default: OLLAMA_MODEL,
      options: []
    },
    {
      key: "temperature",
      label: "Temperature",
      type: "number",
      default: 0.7,
      min: 0,
      max: 2,
      step: 0.1
    }
  ],

  async health() {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/tags`);

      if (!response.ok) {
        throw new Error(
          `Ollama health check failed with HTTP ${response.status}.`
        );
      }

      return {
        available: true,
        provider: "ollama",
        model: OLLAMA_MODEL
      };
    } catch (error) {
      return {
        available: false,
        provider: "ollama",
        model: OLLAMA_MODEL,
        error: error.message
      };
    }
  },

  async metadata() {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);

    if (!response.ok) {
      throw new Error(
        `Ollama model discovery failed with HTTP ${response.status}.`
      );
    }

    const payload = await response.json();
    const models = normalizeModels(payload);

    return {
      models,
      settings: {
        model: {
          type: "select",
          options: models
        }
      }
    };
  },

  async generate(options = {}) {
    return generateStoryboard({
      ollamaUrl: options.ollamaUrl || OLLAMA_URL,
      model: options.model || OLLAMA_MODEL,
      temperature: options.temperature ?? 0.7,
      idea: options.idea,
      length: options.length,
      style: options.style,
      audience: options.audience
    });
  }
};
