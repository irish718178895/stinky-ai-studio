import {
  comfyFetch,
  generateForProject
} from "../../services/comfyui.js";

function removeUndefinedValues(values = {}) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );
}

function normalizeOptions(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .map(value => String(value ?? "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function readComboOptions(nodeDefinition, inputName) {
  const input =
    nodeDefinition?.input?.required?.[inputName] ??
    nodeDefinition?.input?.optional?.[inputName];

  if (!Array.isArray(input) || !Array.isArray(input[0])) {
    return [];
  }

  return normalizeOptions(input[0]);
}

async function fetchNodeDefinition(nodeName) {
  const encodedName = encodeURIComponent(nodeName);

  try {
    const response = await comfyFetch(`/object_info/${encodedName}`);
    const payload = await response.json();

    if (payload?.[nodeName]) {
      return payload[nodeName];
    }
  } catch (error) {
    // Some ComfyUI versions do not support the node-specific endpoint.
    // Fall back to the complete object-info response below.
  }

  const response = await comfyFetch("/object_info");
  const payload = await response.json();
  const definition = payload?.[nodeName];

  if (!definition) {
    throw new Error(
      `ComfyUI did not advertise the required node "${nodeName}".`
    );
  }

  return definition;
}

export const comfyuiProvider = {
  id: "comfyui",
  type: "image",
  name: "ComfyUI",
  version: "1.0",

  settingsSchema: [
    {
      key: "checkpoint",
      label: "Checkpoint",
      type: "select",
      default: "dreamshaper_8.safetensors",
      options: []
    },
    {
      key: "sampler",
      label: "Sampler",
      type: "select",
      default: "euler",
      options: []
    },
    {
      key: "scheduler",
      label: "Scheduler",
      type: "select",
      default: "normal",
      options: []
    },
    {
      key: "steps",
      label: "Steps",
      type: "number",
      default: 20,
      min: 1,
      max: 100,
      step: 1
    },
    {
      key: "cfg",
      label: "CFG",
      type: "number",
      default: 7,
      min: 1,
      max: 30,
      step: 0.5
    }
  ],

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

  async metadata() {
    const [checkpointLoader, samplerNode] = await Promise.all([
      fetchNodeDefinition("CheckpointLoaderSimple"),
      fetchNodeDefinition("KSampler")
    ]);

    const checkpoints = readComboOptions(checkpointLoader, "ckpt_name");
    const samplers = readComboOptions(samplerNode, "sampler_name");
    const schedulers = readComboOptions(samplerNode, "scheduler");

    return {
      checkpoints,
      samplers,
      schedulers,
      settings: {
        checkpoint: {
          type: "select",
          options: checkpoints
        },
        sampler: {
          type: "select",
          options: samplers
        },
        scheduler: {
          type: "select",
          options: schedulers
        }
      }
    };
  },

  async generate(
    projects,
    project,
    settings = {},
    sourceImageId = null
  ) {
    const projectSettings = {
      ...(project.providerSettings?.[this.id] || {})
    };

    const requestSettings = removeUndefinedValues(settings);

    return generateForProject(
      projects,
      project,
      {
        ...projectSettings,
        ...requestSettings
      },
      sourceImageId
    );
  }
};
