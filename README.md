# Stinky AI Studio v0.10

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
