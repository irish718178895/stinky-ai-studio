# Stinky AI Studio v0.11.1 — Service Extraction

This is the second behavior-preserving architecture refactor.

## Extracted services

- `server/services/comfyui.js`
  - ComfyUI HTTP access
  - workflow creation
  - queue polling
  - generated image storage
- `server/services/piper.js`
  - Piper availability checks
  - scene voice synthesis
- `server/services/ffmpeg/video-renderer.js`
  - render settings normalization
  - camera movement filters
  - scene rendering
  - transitions
  - narration and music mixing
  - encoder selection
- `server/utils/process.js`
  - child process execution helpers
- `server/utils/media.js`
  - uploaded music file validation

`server/app.js` remains responsible for HTTP routes and job coordination, but no longer contains the implementation details for the external media engines.

No API route, project format, or frontend behavior was intentionally changed.
