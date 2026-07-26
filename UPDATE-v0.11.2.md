# Stinky AI Studio v0.11.2 — Route Extraction

This behavior-preserving architecture update moves HTTP endpoint handlers out of `server/app.js` into dedicated Express routers.

## New route modules

- `server/routes/health.js`
- `server/routes/projects.js`
- `server/routes/storyboard.js`
- `server/routes/images.js`
- `server/routes/voice.js`
- `server/routes/music.js`
- `server/routes/render.js`

`server/app.js` is now responsible only for middleware, static paths, router registration, storage initialization, and startup.
