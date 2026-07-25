# Stinky AI Studio v0.8

Local image generation, AI storyboarding, queued scene-image production, scene planning, and cinematic MP4 rendering.

## v0.8 highlights

- Generate every missing storyboard image in one queued operation
- Sequential ComfyUI processing to fit limited VRAM
- Automatic image saving and scene assignment
- Per-job progress and current-scene status
- Cancellation after the active ComfyUI generation finishes
- Optional regeneration of scenes that already have assigned images
- Failed scenes remain unassigned so they can be retried after prompt edits

## Services

- Stinky AI Studio: `http://127.0.0.1:3000`
- ComfyUI: `http://127.0.0.1:8188`
- Ollama: `http://127.0.0.1:11434`

## Defaults

- ComfyUI checkpoint: `dreamshaper_8.safetensors`
- Ollama model: `qwen2.5:3b`

Override with `CHECKPOINT`, `COMFY_URL`, `OLLAMA_URL`, or `OLLAMA_MODEL` environment variables.
