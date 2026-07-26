export function setBusy(button, busy, busyText = null) {
  if (!button) return;
  if (busy) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  if (busyText) {
    button.textContent = busy
      ? busyText
      : (button.dataset.originalText || button.textContent);
  }
}

export function cameraMovementLabel(value) {
  return ({
    none: "No movement",
    "zoom-in": "Zoom in",
    "zoom-out": "Zoom out",
    "pan-left": "Pan left",
    "pan-right": "Pan right"
  })[value] || "Zoom in";
}
