# Stinky AI Studio v0.11 — Architecture Foundation

This release is a behavior-preserving backend refactor. It does not change project data, API routes, the browser interface, ComfyUI generation, Ollama storyboards, Piper narration, music mixing, or FFmpeg rendering.

## New structure

```text
server.js                     Thin application bootstrap
server/app.js                 Express application and existing route registration
server/config.js              Environment variables, paths, and resolution settings
server/services/project-store.js
                              Project persistence and normalization
modules/storyboard.js         Existing Ollama storyboard module
public/                       Existing browser application
```

## Upgrade

Copy these files and directories over v0.10 without replacing `data/`:

```text
server.js
server/
package.json
package-lock.json
README.md
UPDATE-v0.11.md
```

Then run:

```bash
node --check server.js
node --check server/app.js
node --check server/config.js
node --check server/services/project-store.js
npm install
npm start
```

## Verification

Verify the following existing workflows before merging the feature branch:

1. Project listing and project creation.
2. ComfyUI health and single-image generation.
3. Ollama health and storyboard generation.
4. Batch scene-image generation.
5. Piper health and narration generation.
6. Music upload and preview.
7. Video rendering with narration and music.
8. Browser refresh preserves all project data.

## Rollback

Because project storage is unchanged, rollback only requires switching to the previous Git branch or commit and running `npm install`.
