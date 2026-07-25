# Update to v0.6

Copy `server.js`, `package.json`, `README.md`, `UPDATE-v0.6.md`, and the three files under `public/` over the existing v0.5 installation. Do not replace `data/`.

Validate with:

```bash
node --check server.js
node --check public/app.js
npm install
npm start
```

The render panel now includes resolution, FPS, transition, and encoder controls. `Auto` uses NVIDIA NVENC when FFmpeg reports it as available, otherwise CPU/libx264.
