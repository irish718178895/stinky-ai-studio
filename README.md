# Stinky AI Studio v0.4

This release adds project maintenance and reusable image-generation settings.

## New in v0.4

- Rename projects and edit descriptions
- Delete projects and their saved image files safely
- Load any saved image settings back into the generator
- Regenerate an image with the same seed
- Regenerate an image with a new random seed
- Improved gallery controls and image-detail actions
- Random-seed reset button

## Upgrade from v0.2

Preserve the `data/` directory. Replace only the application source files, run `npm install`, and restart Node.js. Existing projects and images remain compatible.

## Requirements

- Node.js 18+
- ComfyUI at `http://127.0.0.1:8188`
- `dreamshaper_8.safetensors` in ComfyUI checkpoints

## Run

```bash
cd ~/AI-Studio/stinky-ai-studio
npm install
npm start
```

Open `http://127.0.0.1:3000`.


## v0.4 Scene Builder

Each project can now contain an ordered scene plan. A scene stores:

- Title and visual notes
- Narration text
- Duration in seconds
- Camera movement
- One selected project image
- Scene order

This release prepares the project data for FFmpeg video rendering in v0.5.
