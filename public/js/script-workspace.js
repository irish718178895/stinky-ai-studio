import { jsonFetch } from "./api.js";
import { currentProject } from "./state.js";
import { on, events } from "./events.js";

const AUTOSAVE_DELAY = 1200;
let autosaveTimer = null;
let loading = false;
let lastSerialized = "";

const ids = {
  form: "scriptWorkspaceForm",
  title: "scriptTitle",
  audience: "scriptAudience",
  duration: "scriptDuration",
  style: "scriptStyle",
  tone: "scriptTone",
  callToAction: "scriptCallToAction",
  summary: "scriptSummary",
  content: "scriptContent",
  status: "scriptSaveStatus",
  message: "scriptMessage",
  save: "saveScriptButton",
  storyboard: "scriptToStoryboardButton",
  words: "scriptWordCount",
  characters: "scriptCharacterCount",
  seconds: "scriptEstimatedSeconds",
  version: "scriptVersion"
};

function element(name) {
  return document.getElementById(ids[name]);
}

function serializeForm() {
  return {
    title: element("title").value.trim(),
    audience: element("audience").value.trim(),
    duration: Number(element("duration").value),
    style: element("style").value,
    tone: element("tone").value
      .split(",")
      .map(value => value.trim())
      .filter(Boolean),
    callToAction: element("callToAction").value.trim(),
    summary: element("summary").value.trim(),
    content: element("content").value.trim()
  };
}

function serializedValue() {
  return JSON.stringify(serializeForm());
}

function updateStats() {
  const content = element("content").value.trim();
  const words = content ? content.split(/\s+/).filter(Boolean).length : 0;
  const characters = content.length;
  const estimatedSeconds = words ? Math.max(1, Math.round(words / 2.35)) : 0;

  element("words").textContent = String(words);
  element("characters").textContent = String(characters);
  element("seconds").textContent = String(estimatedSeconds);
}

function setStatus(text, className = "status") {
  const status = element("status");
  status.textContent = text;
  status.className = className;
}

function populate(script = {}) {
  loading = true;

  element("title").value = script.title || "";
  element("audience").value = script.audience || "";
  element("duration").value = String(script.duration || 30);
  element("style").value = script.style || "cinematic";
  element("tone").value = Array.isArray(script.tone) ? script.tone.join(", ") : "";
  element("callToAction").value = script.callToAction || "";
  element("summary").value = script.summary || "";
  element("content").value = script.content || "";
  element("version").textContent = String(script.version || 1);
  element("message").textContent = "";

  updateStats();
  lastSerialized = serializedValue();
  setStatus("Saved", "status ok");

  loading = false;
}

async function loadScript() {
  const project = currentProject();

  clearTimeout(autosaveTimer);

  if (!project) {
    populate({});
    setStatus("No project", "status");
    return;
  }

  setStatus("Loading…", "status");

  try {
    const script = await jsonFetch(`/api/projects/${project.id}/script`);
    project.script = script;
    populate(script);
  } catch (error) {
    setStatus("Load failed", "status bad");
    element("message").textContent = error.message;
  }
}

async function saveScript({ quiet = false } = {}) {
  const project = currentProject();

  if (!project || loading) {
    return null;
  }

  const currentSerialized = serializedValue();

  if (currentSerialized === lastSerialized) {
    if (!quiet) {
      element("message").textContent = "No changes to save.";
    }

    setStatus("Saved", "status ok");
    return project.script || null;
  }

  setStatus("Saving…", "status");
  element("save").disabled = true;

  try {
    const script = await jsonFetch(`/api/projects/${project.id}/script`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: currentSerialized
    });

    project.script = script;
    element("version").textContent = String(script.version || 1);

    lastSerialized = JSON.stringify({
      title: script.title,
      audience: script.audience,
      duration: script.duration,
      style: script.style,
      tone: script.tone,
      callToAction: script.callToAction,
      summary: script.summary,
      content: script.content
    });

    setStatus("Saved", "status ok");
    element("message").textContent = quiet
      ? "Draft saved automatically."
      : `Script saved as version ${script.version}.`;

    return script;
  } catch (error) {
    setStatus("Save failed", "status bad");
    element("message").textContent = error.message;
    throw error;
  } finally {
    element("save").disabled = false;
  }
}

function scheduleAutosave() {
  if (loading || !currentProject()) {
    return;
  }

  updateStats();
  setStatus("Unsaved changes", "status");

  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveScript({ quiet: true }).catch(() => {});
  }, AUTOSAVE_DELAY);
}

async function useForStoryboard() {
  const project = currentProject();

  if (!project) {
    return;
  }

  try {
    const script =
      await saveScript({ quiet: true }) ||
      project.script ||
      serializeForm();

    const idea = document.getElementById("storyboardIdea");
    const length = document.getElementById("storyboardLength");
    const style = document.getElementById("storyboardStyle");
    const audience = document.getElementById("storyboardAudience");

    if (idea) {
      const parts = [
        script.summary,
        script.content,
        script.callToAction
          ? `Call to action: ${script.callToAction}`
          : ""
      ].filter(Boolean);

      idea.value = parts.join("\n\n");
    }

    if (length) {
      const available = [...length.options].map(option => option.value);
      const desired = String(script.duration || 30);
      length.value = available.includes(desired) ? desired : "30";
    }

    if (style) {
      const available = [...style.options].map(option => option.value);
      style.value = available.includes(script.style)
        ? script.style
        : "cinematic";
    }

    if (audience) {
      audience.value = script.audience || "";
    }

    document.querySelector('[data-workspace="storyboard"]')?.click();
    document.getElementById("storyboardIdea")?.focus();

    element("message").textContent =
      "Script loaded into the storyboard generator.";
  } catch {
    // Save errors are already displayed.
  }
}

export function initScriptWorkspace() {
  const form = element("form");

  if (!form) {
    console.warn("Script workspace could not initialize.");
    return;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    clearTimeout(autosaveTimer);
    saveScript().catch(() => {});
  });

  [
    "title",
    "audience",
    "duration",
    "style",
    "tone",
    "callToAction",
    "summary",
    "content"
  ].forEach(name => {
    element(name).addEventListener("input", scheduleAutosave);
    element(name).addEventListener("change", scheduleAutosave);
  });

  element("storyboard").addEventListener("click", useForStoryboard);

  on(events.PROJECTS_LOADED, loadScript);
  on(events.PROJECT_SELECTED, loadScript);

  loadScript();
}
