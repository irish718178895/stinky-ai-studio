#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv-piper
.venv-piper/bin/python -m pip install --upgrade pip
.venv-piper/bin/pip install piper-tts
mkdir -p voices
curl -fL -o voices/en_US-lessac-medium.onnx \
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx?download=true'
curl -fL -o voices/en_US-lessac-medium.onnx.json \
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json?download=true'
echo "Piper and en_US-lessac-medium are installed."
