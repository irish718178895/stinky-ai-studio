# Stinky AI Studio v0.11.3 — Shared Job Service

This behavior-preserving architecture update replaces the separate image and render job maps with one shared in-memory job manager.

## Changes

- Added `server/services/job-manager.js`.
- Image and render jobs now share consistent IDs, timestamps, status updates, error fields, and lifecycle handling.
- Completed jobs are removed automatically after six hours to prevent unlimited memory growth.
- Existing image-job and render-job API endpoints remain unchanged.
- Image cancellation behavior remains unchanged.

## Notes

Jobs remain intentionally in memory for this phase. Restarting Node clears active and completed job records, just as it did in earlier releases. A later release can add persisted jobs or separate worker processes without changing route code.
