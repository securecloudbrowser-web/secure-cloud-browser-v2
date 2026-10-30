---
title: SCB Browser Host
emoji: 🌐
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# SCB Browser Host

Private browser host for the Secure Cloud Browser app. This Space runs a
Chromium browser behind a single-use-token gate — it only answers requests
carrying a valid stream token issued by the web app, and the management API
requires the shared orchestrator token. Browser profiles are synced to the
app's private storage, because this Space's disk is ephemeral.
