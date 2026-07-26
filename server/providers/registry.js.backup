import { comfyuiProvider } from "./image/comfyui.js";
import { piperProvider } from "./voice/piper.js";
import { ffmpegProvider } from "./render/ffmpeg.js";
import { ollamaProvider } from "./story/ollama.js";

const providerRegistry = new Map();

export function registerProvider(provider) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("Provider must be an object.");
  }

  if (!provider.type || typeof provider.type !== "string") {
    throw new TypeError("Provider must define a string type.");
  }

  if (!provider.id || typeof provider.id !== "string") {
    throw new TypeError("Provider must define a string id.");
  }

  const type = provider.type.trim();
  const id = provider.id.trim();

  if (!type || !id) {
    throw new TypeError("Provider type and id cannot be empty.");
  }

  if (!providerRegistry.has(type)) {
    providerRegistry.set(type, new Map());
  }

  const providers = providerRegistry.get(type);

  if (providers.has(id)) {
    throw new Error(
      `Provider "${id}" is already registered for type "${type}".`
    );
  }

  providers.set(id, provider);
  return provider;
}

export function getProvider(type, id = null) {
  const providers = providerRegistry.get(type);

  if (!providers || providers.size === 0) {
    throw new Error(`No providers are registered for type "${type}".`);
  }

  if (id) {
    const provider = providers.get(id);

    if (!provider) {
      throw new Error(
        `Provider "${id}" is not registered for type "${type}".`
      );
    }

    return provider;
  }

  return providers.values().next().value;
}

export function listProviders(type = null) {
  if (type) {
    return [...(providerRegistry.get(type)?.values() || [])];
  }

  return [...providerRegistry.values()]
    .flatMap(providers => [...providers.values()]);
}

export function hasProvider(type, id) {
  return providerRegistry.get(type)?.has(id) || false;
}

registerProvider(comfyuiProvider);
registerProvider(piperProvider);
registerProvider(ffmpegProvider);
registerProvider(ollamaProvider);
