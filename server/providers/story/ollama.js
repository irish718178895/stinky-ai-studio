import { generateStoryboard } from "../../../modules/storyboard.js";
import { OLLAMA_URL, OLLAMA_MODEL } from "../../config.js";

export const ollamaProvider = {
  id: "ollama",
  type: "story",
  name: "Ollama",

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

  async generate(options = {}) {
    return generateStoryboard({
      ollamaUrl: options.ollamaUrl || OLLAMA_URL,
      model: options.model || OLLAMA_MODEL,
      idea: options.idea,
      length: options.length,
      style: options.style,
      audience: options.audience
    });
  }
};
