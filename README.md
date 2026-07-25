# Stinky AI Studio v0.2

This release adds persistent project management and per-project image galleries.

## New in v0.2

- Create named projects with descriptions
- Generate images inside a selected project
- Copy generated PNGs into the app's own project storage
- Preserve prompt, negative prompt, seed, model, CFG, steps, and resolution
- Persistent gallery after application restarts
- Click an image for full-size display and metadata
- Delete unwanted project images

## Requirements

- Node.js 18+
- ComfyUI at `http://127.0.0.1:8188`
- `dreamshaper_8.safetensors` in ComfyUI checkpoints

## Fresh installation

```bash
unzip stinky-ai-studio-v0.2.zip -d ~/AI-Studio/
cd ~/AI-Studio/stinky-ai-studio
npm install
npm start
```

## Upgrade from v0.1

Stop the old Node process with Ctrl+C, then:

```bash
cd ~/AI-Studio
mv stinky-ai-studio stinky-ai-studio-v0.1-backup
unzip ~/Downloads/stinky-ai-studio-v0.2.zip -d ~/AI-Studio/
cd ~/AI-Studio/stinky-ai-studio
npm install
npm start
```

Open `http://127.0.0.1:3000`.

## Storage

Project metadata:

```text
data/projects.json
```

Project image files:

```text
data/projects/<project-id>/
```

Back up the entire `data` directory to preserve projects and images.
