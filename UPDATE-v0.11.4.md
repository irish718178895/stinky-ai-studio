# Stinky AI Studio v0.11.4 — Frontend Foundation

This release begins the browser-side architecture refactor without changing the user interface or API contract.

## New frontend modules

- `public/js/api.js` — shared JSON HTTP client
- `public/js/state.js` — application state and selected-project helpers
- `public/js/dom.js` — cached DOM references
- `public/js/ui.js` — reusable UI helpers

`public/app.js` remains the feature coordinator, but no longer owns networking, global state, DOM discovery, or generic UI utilities.

## Compatibility

- Existing projects and generated media are unchanged.
- Existing API endpoints are unchanged.
- The page still loads through `/app.js` as an ES module.
