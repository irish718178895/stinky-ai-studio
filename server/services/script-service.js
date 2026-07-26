const SCRIPT_STYLES = Object.freeze([
  "industrial", "cinematic", "documentary", "dramatic",
  "funny", "inspirational", "custom"
]);

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanTone(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [...new Set(source.map(item => cleanText(item, 50)).filter(Boolean))].slice(0, 8);
}

function cleanDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration)
    ? Math.min(300, Math.max(5, Math.round(duration)))
    : 30;
}

export function createDefaultScript(now = new Date().toISOString()) {
  return {
    title: "",
    summary: "",
    audience: "",
    duration: 30,
    style: "cinematic",
    tone: [],
    callToAction: "",
    content: "",
    version: 1,
    history: [],
    updatedAt: now
  };
}

export function normalizeScript(script, now = new Date().toISOString()) {
  const defaults = createDefaultScript(now);
  const source = script && typeof script === "object" && !Array.isArray(script)
    ? script
    : {};

  const history = Array.isArray(source.history)
    ? source.history
        .filter(item => item && typeof item === "object" && !Array.isArray(item))
        .slice(-25)
        .map(item => ({
          version: Math.max(1, Number(item.version) || 1),
          title: cleanText(item.title, 150),
          summary: cleanText(item.summary, 1000),
          audience: cleanText(item.audience, 200),
          duration: cleanDuration(item.duration),
          style: SCRIPT_STYLES.includes(item.style) ? item.style : "custom",
          tone: cleanTone(item.tone),
          callToAction: cleanText(item.callToAction, 500),
          content: cleanText(item.content, 20000),
          savedAt: item.savedAt || now
        }))
    : [];

  return {
    ...defaults,
    title: cleanText(source.title, 150),
    summary: cleanText(source.summary, 1000),
    audience: cleanText(source.audience, 200),
    duration: cleanDuration(source.duration),
    style: SCRIPT_STYLES.includes(source.style) ? source.style : "custom",
    tone: cleanTone(source.tone),
    callToAction: cleanText(source.callToAction, 500),
    content: cleanText(source.content, 20000),
    version: Math.max(1, Number(source.version) || 1),
    history,
    updatedAt: source.updatedAt || now
  };
}

function snapshotScript(script, savedAt) {
  return {
    version: script.version,
    title: script.title,
    summary: script.summary,
    audience: script.audience,
    duration: script.duration,
    style: script.style,
    tone: [...script.tone],
    callToAction: script.callToAction,
    content: script.content,
    savedAt
  };
}

function changed(current, next) {
  const comparable = value => ({
    title: value.title,
    summary: value.summary,
    audience: value.audience,
    duration: value.duration,
    style: value.style,
    tone: value.tone,
    callToAction: value.callToAction,
    content: value.content
  });

  return JSON.stringify(comparable(current)) !== JSON.stringify(comparable(next));
}

export function updateScript(existingScript, patch = {}, now = new Date().toISOString()) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("Script update must be an object.");
  }

  const current = normalizeScript(existingScript, now);
  const next = normalizeScript({
    ...current,
    ...patch,
    history: current.history,
    version: current.version,
    updatedAt: now
  }, now);

  if (!changed(current, next)) return current;

  return {
    ...next,
    version: current.version + 1,
    history: [...current.history, snapshotScript(current, now)].slice(-25),
    updatedAt: now
  };
}

export const scriptService = Object.freeze({
  createDefault: createDefaultScript,
  normalize: normalizeScript,
  update: updateScript
});
