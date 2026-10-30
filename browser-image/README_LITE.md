# Lite browser image (Firefox ESR)

Created 2026-10-20 at Faisal's request ("Chrome ke elawa koi lite browser").

## Why
The main image (Chromium + KasmVNC full desktop) needs ~2 GB RAM per browser.
Every free host found gives only 512 MB–1 GB per app, so the main image
cannot run there. This lite image is the fallback for those hosts.

## What is different
- Firefox ESR instead of Chromium (with RAM-saving prefs baked in:
  1 content process, small caches, no telemetry, no GPU/video accel).
- No desktop environment: Xvfb + openbox + x11vnc + noVNC only.
- Target total usage: roughly 600–900 MB for light browsing, 1–2 tabs.
  (Estimate only — NOT measured; the image has never been built or run,
  because Docker is unavailable in the dev VM.)

## Honest limits
- Modern websites are heavy by themselves: one Gmail/Facebook/YouTube tab
  can use 300–500 MB in ANY browser. Lite saves the browser's own weight,
  not the website's. Heavy multi-tab use will still not fit in 1 GB.
- 512 MB hosts (e.g. Blitz free) are still too small, even for lite.
- Free hosts that sleep when idle (DockHosting, Blitz, Render) will still
  stop the container; the Firefox profile (logins/cookies) survives on the
  volume, but the live session ends and must be reopened.
- Some sites serve reduced/blocked pages to Firefox or require Chromium;
  the main Chromium image remains the "full" version for a real server
  (Oracle / Contabo / own PC).

## Files
- `Dockerfile.lite` — build: `docker build -f browser-image/Dockerfile.lite -t scb-browser-lite browser-image/`
- Streams on port 6901 inside the container network only, same as the
  main image, so the orchestrator/proxy design does not change.
