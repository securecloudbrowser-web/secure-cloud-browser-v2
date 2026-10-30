# Secure Cloud Browser — Hugging Face Space image (browser host, free tier).
# One container runs everything: Chromium + KasmVNC (the browser, internal
# port 6901, never published) and gate.js (the token-gated orchestrator API
# + stream proxy on the Space port 7860). The browser profile lives in
# /profile and is synced to Supabase Storage by gate.js — the Space disk
# itself is ephemeral.
FROM debian:bookworm-slim

USER root
# KasmVNC is NOT published as a ready base image under
# "kasmvnc/kasmvnc-server" (that Docker Hub repo does not exist — verified
# 2026-10-22 during the Codespaces demo build). Install the official
# KasmVNC .deb for Debian Bookworm from the KasmVNC GitHub releases
# (asset URL verified live 2026-10-22, HTTP 200).
ARG KASMVNC_VERSION=1.5.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && curl -fsSL -o /tmp/kasmvncserver.deb \
      "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvncserver_bookworm_${KASMVNC_VERSION}_amd64.deb" \
    && apt-get install -y --no-install-recommends /tmp/kasmvncserver.deb \
    && rm -f /tmp/kasmvncserver.deb \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium nodejs ca-certificates fonts-liberation openbox tar gzip openssl \
    && rm -rf /var/lib/apt/lists/*

# Non-root browser user; /profile holds the persistent Chromium profile.
RUN useradd -m -s /bin/bash browser || true
ENV HOME=/home/browser
RUN mkdir -p /profile /home/browser/.vnc /app \
    && chown -R browser:browser /profile /home/browser

# KasmVNC 1.5 refuses to start non-interactively until a user with write
# permissions exists in ~/.vnc/passwd (it stops at an interactive prompt
# and exits — found live in the Codespaces demo, 2026-10-22). Pre-create
# that user at build time. Internal only: the password never faces the
# network — port 6901 is reachable solely through the token-gated proxy
# and the server runs with -SecurityTypes None behind it.
RUN su browser -s /bin/bash -c 'printf "scbstream\nscbstream\nn\n" | kasmvncpasswd -u browser -w'

# KasmVNC validates its TLS certificate files at startup and exits if the
# Debian snakeoil pair is missing (found live 2026-10-22: EXIT=1,
# "/etc/ssl/private/ssl-cert-snakeoil.key: certificate file doesn't exist").
# Generate a self-signed pair and install it at the default paths. The key
# is a throwaway localhost cert — it protects nothing beyond the token
# gate, so world-readable inside this image is acceptable here.
RUN su browser -s /bin/bash -c 'openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout /home/browser/.vnc/scb.key -out /home/browser/.vnc/scb.crt -subj "/CN=localhost"' \
    && mkdir -p /etc/ssl/certs /etc/ssl/private \
    && cp /home/browser/.vnc/scb.crt /etc/ssl/certs/ssl-cert-snakeoil.pem \
    && cp /home/browser/.vnc/scb.key /etc/ssl/private/ssl-cert-snakeoil.key \
    && chmod 644 /etc/ssl/certs/ssl-cert-snakeoil.pem /etc/ssl/private/ssl-cert-snakeoil.key \
    && chmod 755 /etc/ssl/private

# Two KasmVNC settings the defaults get wrong for this design (both found
# live 2026-10-22): /etc/ssl/private ships as drwx--x--- root:ssl-cert, so
# the browser user cannot even reach the key (fixed above) — and
# network.ssl.require_ssl defaults to true, which would make 6901 HTTPS-
# only while the gate proxies plain HTTP inside the container. Ship the
# per-user config with require_ssl off (the logging block mirrors what
# KasmVNC generates itself). 6901 never leaves the container; the public
# surface stays the token-gated 7860.
RUN printf '%s\n' \
      'logging:' \
      '  log_writer_name: all' \
      '  log_dest: logfile' \
      '  level: 100' \
      'network:' \
      '  ssl:' \
      '    require_ssl: false' \
      > /home/browser/.vnc/kasmvnc.yaml \
    && chown browser:browser /home/browser/.vnc/kasmvnc.yaml

# KasmVNC session startup: a light window manager + Chromium pointed at the
# persistent profile directory.
RUN printf '%s\n' \
      '#!/bin/sh' \
      'unset SESSION_MANAGER' \
      'unset DBUS_SESSION_BUS_ADDRESS' \
      'openbox &' \
      'chromium --user-data-dir=/profile/chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --start-maximized about:blank &' \
      'wait' \
      > /home/browser/.vnc/xstartup \
    && chmod +x /home/browser/.vnc/xstartup \
    && chown browser:browser /home/browser/.vnc/xstartup

COPY gate.js /app/gate.js
WORKDIR /app
EXPOSE 7860
CMD ["node", "gate.js"]
