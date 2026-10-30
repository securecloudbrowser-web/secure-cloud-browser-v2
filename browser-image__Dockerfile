# Browser container image: Chromium + KasmVNC streaming (v2 decision: ONE stack).
# STATUS: NOT built or tested — Docker is unavailable in the current dev VM.
# Build on the VPS / any Docker host with:  docker build -t scb-browser browser-image/
FROM debian:bookworm-slim

USER root
# KasmVNC is NOT published as a ready base image under
# "kasmvnc/kasmvnc-server" (that Docker Hub repo does not exist — verified
# 2026-10-22). Install the official KasmVNC .deb for Debian Bookworm from
# the KasmVNC GitHub releases (asset URL verified live 2026-10-22).
ARG KASMVNC_VERSION=1.5.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && curl -fsSL -o /tmp/kasmvncserver.deb \
      "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvncserver_bookworm_${KASMVNC_VERSION}_amd64.deb" \
    && apt-get install -y --no-install-recommends /tmp/kasmvncserver.deb \
    && rm -f /tmp/kasmvncserver.deb \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-liberation openssl \
    && rm -rf /var/lib/apt/lists/*

# Non-root browser user; profile dir is a mounted volume, mode 0700.
RUN useradd -m -s /bin/bash browser || true
ENV HOME=/home/browser
# KasmVNC 1.5 refuses to start non-interactively until a user with write
# permissions exists in ~/.vnc/passwd (interactive prompt → exit; found
# live 2026-10-22). Pre-create it at build time. Internal only — 6901 is
# reachable solely through the authenticated proxy (see note below).
RUN mkdir -p /home/browser/.vnc && chown browser:browser /home/browser/.vnc \
    && su browser -s /bin/bash -c 'printf "scbstream\nscbstream\nn\n" | kasmvncpasswd -u browser -w'
# Same two first-run fixes as hf-space (see notes there): KasmVNC 1.5 exits
# without a TLS cert at the Debian snakeoil paths — generate + install one.
RUN su browser -s /bin/bash -c 'openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout /home/browser/.vnc/scb.key -out /home/browser/.vnc/scb.crt -subj "/CN=localhost"' \
    && mkdir -p /etc/ssl/certs /etc/ssl/private \
    && cp /home/browser/.vnc/scb.crt /etc/ssl/certs/ssl-cert-snakeoil.pem \
    && cp /home/browser/.vnc/scb.key /etc/ssl/private/ssl-cert-snakeoil.key \
    && chmod 644 /etc/ssl/certs/ssl-cert-snakeoil.pem /etc/ssl/private/ssl-cert-snakeoil.key \
    && chmod 755 /etc/ssl/private
# Same require_ssl-off per-user config as hf-space (the noVNC proxy also
# speaks plain HTTP to 6901 inside the container).
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
# Chromium user-data dir lives on the per-profile persistent volume:
#   docker run -v scb-profile-<storageKey>:/profile ... with /profile mode 0700
# The orchestrator passes: --user-data-dir=/profile/chromium
# KasmVNC streams on 6901 INSIDE the container network only — never published
# publicly; access goes through the app + short-lived stream token + proxy.
# DevTools port must NEVER be bound to a public interface.
EXPOSE 6901
USER browser
CMD ["sh", "-c", "printf '1\\n' | kasmvncserver :1 -websocketPort 6901 -SecurityTypes None"]
# NOTE: "-SecurityTypes None" is only acceptable because the port is reachable
# solely through the authenticated reverse proxy inside the private container
# network. Verify this on the Docker host before any real use.
