# Stinky AI Studio v0.11

A completely local creative pipeline using ComfyUI, Ollama, Piper, Node.js, and FFmpeg.

## Features

- AI storyboard generation through Ollama
- Queued scene-image generation through ComfyUI
- Ordered scene builder
- Local Piper narration per scene
- 720p/1080p cinematic video rendering
- Cuts, crossfades, dip-to-black, audio crossfades, and optional narration

## Start

```bash
npm install
npm start
```

The app listens on `http://127.0.0.1:3000`.

## Install Piper

```bash
sudo apt install -y python3-venv curl
./INSTALL-PIPER.sh
```

The default voice is expected at `voices/en_US-lessac-medium.onnx`. Override the executable or model with `PIPER_COMMAND` and `PIPER_MODEL` environment variables.


## Background music (v0.10)

Upload a local MP3, WAV, M4A, AAC, OGG, or FLAC file to a project, preview it in the browser, and include it in a render. The renderer can loop the track, set its volume, fade it in and out, and automatically duck it beneath Piper narration. Uploaded music stays under the project data directory and is not committed to Git.

## Architecture foundation (v0.11)

The backend now starts from a thin `server.js` bootstrap. Runtime configuration lives in `server/config.js`, project persistence lives in `server/services/project-store.js`, and the Express application lives in `server/app.js`. This is the first behavior-preserving step toward independent routes, AI providers, render services, and background jobs.

## v0.11.2 service architecture

External engine code now lives under `server/services/`, while shared child-process and media helpers live under `server/utils/`. The HTTP API remains compatible with v0.10 and v0.11.0.


## v0.11.2 architecture

HTTP endpoints are organized under `server/routes/`, while `server/app.js` handles application assembly and startup.

## v0.11.4 shared job architecture

Image generation and video rendering now use `server/services/job-manager.js` for consistent job creation, progress updates, cancellation state, timestamps, errors, and retention cleanup. Existing browser API contracts remain compatible.

## v0.11.4 frontend architecture

Browser-side foundations now live under `public/js/`, separating API access, state, DOM references, and generic UI helpers from the feature coordinator in `public/app.js`.
