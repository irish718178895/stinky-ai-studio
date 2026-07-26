import {
  getProvider,
  hasProvider,
  listProviders
} from "./registry.js";

export const PROVIDER_TYPES = Object.freeze([
  "image",
  "story",
  "voice",
  "render"
]);

export const DEFAULT_PROVIDER_IDS = Object.freeze({
  image: "comfyui",
  story: "ollama",
  voice: "piper",
  render: "ffmpeg"
});

function cleanProviderId(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Return a complete provider manifest.
 *
 * Missing or invalid provider IDs fall back to the current defaults.
 * This makes older projects compatible with the provider system.
 */
export function normalizeProviderManifest(manifest = {}) {
  const source =
    manifest && typeof manifest === "object" && !Array.isArray(manifest)
      ? manifest
      : {};

  return Object.fromEntries(
    PROVIDER_TYPES.map(type => {
      const requestedId = cleanProviderId(source[type]);
      const defaultId = DEFAULT_PROVIDER_IDS[type];

      return [
        type,
        requestedId && hasProvider(type, requestedId)
          ? requestedId
          : defaultId
      ];
    })
  );
}

/**
 * Validate a manifest without silently changing it.
 *
 * Returns a normalized manifest when valid and throws when an explicitly
 * supplied provider does not exist.
 */
export function validateProviderManifest(manifest = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("Provider manifest must be an object.");
  }

  for (const type of PROVIDER_TYPES) {
    if (manifest[type] === undefined || manifest[type] === null) {
      continue;
    }

    const id = cleanProviderId(manifest[type]);

    if (!id) {
      throw new Error(`Provider ID for "${type}" cannot be empty.`);
    }

    if (!hasProvider(type, id)) {
      throw new Error(
        `Provider "${id}" is not registered for type "${type}".`
      );
    }
  }

  return normalizeProviderManifest(manifest);
}

/**
 * Select a provider using a project manifest.
 */
export function selectProvider(type, manifest = {}) {
  if (!PROVIDER_TYPES.includes(type)) {
    throw new Error(`Unsupported provider type "${type}".`);
  }

  const normalized = normalizeProviderManifest(manifest);
  return getProvider(type, normalized[type]);
}

/**
 * Return provider metadata suitable for API responses and future UI use.
 */
export function listProviderSummaries(type = null) {
  if (type !== null && !PROVIDER_TYPES.includes(type)) {
    throw new Error(`Unsupported provider type "${type}".`);
  }

  return listProviders(type).map(provider => ({
    id: provider.id,
    type: provider.type,
    name: provider.name,
    capabilities: Array.isArray(provider.capabilities)
      ? [...provider.capabilities]
      : []
  }));
}

/**
 * Check every registered provider that exposes a health() method.
 */
export async function checkProviderHealth(type = null) {
  if (type !== null && !PROVIDER_TYPES.includes(type)) {
    throw new Error(`Unsupported provider type "${type}".`);
  }

  const providers = listProviders(type);

  return Promise.all(
    providers.map(async provider => {
      if (typeof provider.health !== "function") {
        return {
          id: provider.id,
          type: provider.type,
          name: provider.name,
          available: null,
          message: "Provider does not expose a health check."
        };
      }

      try {
        const result = await provider.health();

        return {
          id: provider.id,
          type: provider.type,
          name: provider.name,
          ...result
        };
      } catch (error) {
        return {
          id: provider.id,
          type: provider.type,
          name: provider.name,
          available: false,
          error: error.message
        };
      }
    })
  );
}

export const providerManager = Object.freeze({
  defaults: DEFAULT_PROVIDER_IDS,
  types: PROVIDER_TYPES,
  normalize: normalizeProviderManifest,
  validate: validateProviderManifest,
  select: selectProvider,
  list: listProviderSummaries,
  health: checkProviderHealth
});
