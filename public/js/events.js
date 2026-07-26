/**
 * Lightweight application event bus.
 *
 * Features:
 * - Subscribe to named events
 * - Unsubscribe individual listeners
 * - Subscribe once
 * - Publish event payloads
 * - Clear listeners during teardown
 * - Isolate listener failures
 */

const listeners = new Map();

/**
 * Subscribe to an event.
 *
 * @param {string} eventName
 * @param {(payload: any) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function on(eventName, handler) {
  validateEventName(eventName);
  validateHandler(handler);

  if (!listeners.has(eventName)) {
    listeners.set(eventName, new Set());
  }

  listeners.get(eventName).add(handler);

  return () => off(eventName, handler);
}

/**
 * Subscribe to an event for one invocation only.
 *
 * @param {string} eventName
 * @param {(payload: any) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function once(eventName, handler) {
  validateEventName(eventName);
  validateHandler(handler);

  const wrappedHandler = (payload) => {
    off(eventName, wrappedHandler);
    handler(payload);
  };

  return on(eventName, wrappedHandler);
}

/**
 * Remove a specific event listener.
 *
 * @param {string} eventName
 * @param {(payload: any) => void} handler
 * @returns {boolean} true when the listener existed
 */
export function off(eventName, handler) {
  const eventListeners = listeners.get(eventName);

  if (!eventListeners) {
    return false;
  }

  const removed = eventListeners.delete(handler);

  if (eventListeners.size === 0) {
    listeners.delete(eventName);
  }

  return removed;
}

/**
 * Publish an event.
 *
 * A copy of the listener set is used so listeners may safely unsubscribe
 * themselves while the event is being processed.
 *
 * @param {string} eventName
 * @param {any} payload
 * @returns {number} number of listeners invoked
 */
export function emit(eventName, payload = undefined) {
  validateEventName(eventName);

  const eventListeners = listeners.get(eventName);

  if (!eventListeners || eventListeners.size === 0) {
    return 0;
  }

  const handlers = [...eventListeners];

  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`Event listener failed for "${eventName}":`, error);
    }
  }

  return handlers.length;
}

/**
 * Remove listeners.
 *
 * @param {string} [eventName] omit to remove every listener
 */
export function clear(eventName) {
  if (eventName === undefined) {
    listeners.clear();
    return;
  }

  validateEventName(eventName);
  listeners.delete(eventName);
}

/**
 * Return the number of listeners registered for an event.
 *
 * Primarily useful for diagnostics and tests.
 *
 * @param {string} eventName
 * @returns {number}
 */
export function listenerCount(eventName) {
  validateEventName(eventName);
  return listeners.get(eventName)?.size ?? 0;
}

function validateEventName(eventName) {
  if (typeof eventName !== "string" || eventName.trim() === "") {
    throw new TypeError("Event name must be a non-empty string.");
  }
}

function validateHandler(handler) {
  if (typeof handler !== "function") {
    throw new TypeError("Event handler must be a function.");
  }
}

export const events = Object.freeze({
  PROJECTS_LOADED: "projects:loaded",
  PROJECT_SELECTED: "project:selected",
  PROJECT_CREATED: "project:created",
  PROJECT_UPDATED: "project:updated",
  PROJECT_DELETED: "project:deleted",

  SCENE_SELECTED: "scene:selected",
  SCENE_CREATED: "scene:created",
  SCENE_UPDATED: "scene:updated",
  SCENE_DELETED: "scene:deleted",
  SCENES_REORDERED: "scenes:reordered",

  IMAGE_GENERATION_STARTED: "image:generation-started",
  IMAGE_GENERATION_PROGRESS: "image:generation-progress",
  IMAGE_GENERATED: "image:generated",
  IMAGE_DELETED: "image:deleted",
  IMAGE_GENERATION_FAILED: "image:generation-failed",

  STORYBOARD_GENERATED: "storyboard:generated",

  VOICE_GENERATION_STARTED: "voice:generation-started",
  VOICE_GENERATED: "voice:generated",
  VOICE_GENERATION_FAILED: "voice:generation-failed",

  MUSIC_UPLOADED: "music:uploaded",
  MUSIC_SELECTED: "music:selected",
  MUSIC_DELETED: "music:deleted",

  RENDER_STARTED: "render:started",
  RENDER_PROGRESS: "render:progress",
  RENDER_COMPLETED: "render:completed",
  RENDER_FAILED: "render:failed",
  RENDER_DELETED: "render:deleted",

  STATUS_CHANGED: "status:changed"
});
