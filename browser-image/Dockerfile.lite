# LITE browser container image: Firefox ESR + minimal streaming stack.
# Purpose: run on ~1 GB RAM free hosts (e.g. DockHosting free = 1 GB/app)
# where the full Chromium + KasmVNC desktop image (~2 GB) cannot fit.
# STATUS: NOT built or tested — Docker is unavailable in the current dev VM.
# Build on any Docker host with:
#   docker build -f browser-image/Dockerfile.lite -t scb-browser-lite browser-image/
# Run with a memory cap, e.g.:  docker run --memory=900m ...
FROM debian:bookworm-slim

USER root
# No full desktop: Xvfb (virtual screen) + openbox (tiny window manager)
# + x11vnc + noVNC/websockify (browser-based streaming, same idea as main image).
RUN apt-get update && apt-get install -y --no-install-recommends \
      firefox-esr xvfb x11vnc novnc websockify openbox \
      ca-certificates fonts-liberation dbus-x11 procps \
    && rm -rf /var/lib/apt/lists/*

# Non-root browser user; profile dir is a mounted volume, mode 0700.
RUN useradd -m -s /bin/bash browser || true
ENV HOME=/home/browser

# RAM-saving Firefox defaults (applied to every profile):
# single content process, small caches, no telemetry, no GPU accel.
RUN mkdir -p /usr/lib/firefox-esr/defaults/pref \
 && printf '%s\n' \
  'pref("browser.sessionhistory.max_total_viewers", 0);' \
  'pref("browser.cache.memory.capacity", 32768);' \
  'pref("browser.cache.disk.capacity", 51200);' \
  'pref("dom.ipc.processCount", 1);' \
  'pref("layers.acceleration.disabled", true);' \
  'pref("media.hardware-video-decoding.enabled", false);' \
  'pref("toolkit.telemetry.enabled", false);' \
  'pref("browser.shell.checkDefaultBrowser", false);' \
  > /usr/lib/firefox-esr/defaults/pref/scb-lite.js

# Firefox profile lives on the per-profile persistent volume:
#   docker run -v scb-profile-<storageKey>:/profile ... with /profile mode 0700
# The orchestrator passes: -profile /profile/firefox
# noVNC streams on 6901 INSIDE the container network only — never published
# publicly; access goes through the app + short-lived stream token + proxy,
# exactly like the main Chromium image.
EXPOSE 6901
USER browser
CMD ["bash", "-lc", "Xvfb :1 -screen 0 1280x800x24 & sleep 1; openbox & x11vnc -display :1 -forever -shared -rfbport 5901 -passwd scbstream & websockify --web=/usr/share/novnc 6901 localhost:5901 & DISPLAY=:1 firefox-esr -profile /profile/firefox -no-remote; wait"]
# NOTE: the x11vnc password above is a placeholder for the private container
# network only (same trust model as the main image's KasmVNC note): port 6901
# must only ever be reachable through the authenticated reverse proxy.
# Replace with a per-session secret injected by the orchestrator before
# any real use.
