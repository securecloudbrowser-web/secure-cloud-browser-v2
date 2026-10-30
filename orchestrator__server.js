// Secure Cloud Browser — Orchestrator service (runs on the Docker host).
//
// This is the ONLY component allowed to manage browser containers. The web
// app (Vercel) calls it over an internal/token-protected HTTP API — it never
// touches the Docker socket itself.
//
// Plain Node.js (built-ins only, no npm dependencies):  node server.js
// Docker is driven through the `docker` CLI with argument arrays (no shell),
// so profile/session values can never become shell injection.
//
// Endpoints (all except /health and /s/* require: Authorization: Bearer <ORCHESTRATOR_INTERNAL_TOKEN>)
//   GET  /health                          -> { ok, docker, image }
//   POST /containers                      -> launch one container for a profile
//   GET  /containers/:sessionId           -> { status }
//   POST /containers/:sessionId/stop      -> stop + remove the container
//   POST /profiles/:profileId/reconnect   -> { handle | null }
//   POST /containers/:sessionId/stream-token { tokenHash, expiresAt }
//   GET  /s/:sessionId/:rawToken          -> validates the single-use stream
//        token (compares SHA-256 hashes), sets a 5-minute stream cookie and
//        redirects to /s/:sessionId/ which is proxied (HTTP + WebSocket) to
//        the container's streaming port on localhost only.
//
// Containers are NEVER published on a public interface: each one binds its
// streaming port to 127.0.0.1 on an ephemeral host port, reachable only
// through this service's token gate (or directly on the host itself).

"use strict";
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const PORT = Number(process.env.ORCHESTRATOR_PORT || 8080);
const TOKEN = process.env.ORCHESTRATOR_INTERNAL_TOKEN || "";
const IMAGE = process.env.BROWSER_IMAGE || "scb-browser";
const PROFILE_ROOT = process.env.PROFILE_ROOT || path.join(__dirname, "profiles");
const PUBLIC_BASE = (process.env.ORCHESTRATOR_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const STREAM_COOKIE = "scb_stream";

if (!TOKEN) {
  console.error("FATAL: ORCHESTRATOR_INTERNAL_TOKEN is not set. Refusing to start.");
  process.exit(1);
}

const sessions = new Map(); // sessionId -> { containerId, hostPort, profileId, streamTokenHash, streamExpiresAt }

function docker(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || "docker error").toString().trim()));
      else resolve(stdout.toString().trim());
    });
  });
}

async function dockerAvailable() {
  try { await docker(["version", "--format", "{{.Server.Version}}"], 8000); return true; }
  catch { return false; }
}

function safeKey(v) {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v) ? v : null;
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch { resolve({}); }
    });
  });
}

function authed(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

async function launch(body) {
  const profileId = safeKey(body.profileId);
  const storageKey = safeKey(body.storageKey);
  if (!profileId || !storageKey) throw Object.assign(new Error("invalid profileId/storageKey"), { http: 400 });
  if (!(await dockerAvailable())) {
    throw Object.assign(new Error("Docker is not available on this host — the browser cannot start."), { http: 503 });
  }
  const sessionId = crypto.randomUUID();
  const limits = body.limits || {};
  const cpus = String(limits.cpu || 2);
  const memory = `${Number(limits.memoryMb || 2048)}m`;
  const profileDir = path.join(PROFILE_ROOT, storageKey);
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  const args = [
    "run", "-d",
    "--name", `scb-${sessionId}`,
    "--label", `scb.session=${sessionId}`,
    "--label", `scb.profile=${profileId}`,
    "--cpus", cpus,
    "--memory", memory,
    "-p", "127.0.0.1::6901",
    "-v", `${profileDir}:/profile`,
    "-e", `TZ=${body.timezone || "UTC"}`,
    IMAGE
  ];
  const containerId = await docker(args, 120000);
  const info = JSON.parse(await docker(["inspect", containerId]));
  const hostPort = Number(info[0].NetworkSettings.Ports["6901/tcp"][0].HostPort);
  sessions.set(sessionId, { containerId, hostPort, profileId, streamTokenHash: null, streamExpiresAt: 0 });
  return { sessionId, status: "running", containerRef: containerId.slice(0, 12) };
}

async function containerStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return "stopped";
  try {
    const state = await docker(["inspect", "--format", "{{.State.Status}}", s.containerId], 10000);
    return state === "running" ? "running" : "stopped";
  } catch { return "stopped"; }
}

async function stop(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { await docker(["rm", "-f", s.containerId], 30000); } catch { /* already gone */ }
  sessions.delete(sessionId);
}

async function reconnect(profileId) {
  const out = await docker(["ps", "--filter", `label=scb.profile=${profileId}`, "--format", "{{.ID}} {{.Label \"scb.session\"}}"], 10000).catch(() => "");
  if (!out) return null;
  const [containerId, sessionId] = out.split("\n")[0].split(/\s+/);
  if (!containerId || !sessionId) return null;
  if (!sessions.has(sessionId)) {
    const info = JSON.parse(await docker(["inspect", containerId]));
    const hostPort = Number(info[0].NetworkSettings.Ports["6901/tcp"][0].HostPort);
    sessions.set(sessionId, { containerId, hostPort, profileId, streamTokenHash: null, streamExpiresAt: 0 });
  }
  return { sessionId, status: "running", containerRef: containerId.slice(0, 12) };
}

// --- stream gate ------------------------------------------------------------
function streamCookieOk(req, sessionId) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(new RegExp(`${STREAM_COOKIE}=([a-f0-9]{64})`));
  if (!m) return false;
  const s = sessions.get(sessionId);
  return !!s && s.streamCookieHash === m[1] && Date.now() < (s.streamCookieExpiresAt || 0);
}

function proxyHttp(req, res, session) {
  const upstreamPath = req.url.replace(/^\/s\/[^/]+/, "") || "/";
  const up = http.request(
    { host: "127.0.0.1", port: session.hostPort, path: upstreamPath, method: req.method, headers: req.headers },
    (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }
  );
  up.on("error", () => { if (!res.headersSent) sendJson(res, 502, { error: "browser stream unreachable" }); });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, docker: await dockerAvailable(), image: IMAGE, publicBase: PUBLIC_BASE });
    }

    // Stream gate: /s/:sessionId/:rawToken  or  /s/:sessionId/... (cookie)
    if (parts[0] === "s" && parts[1]) {
      const sessionId = parts[1];
      const s = sessions.get(sessionId);
      if (!s) return sendJson(res, 404, { error: "session not found" });
      if (parts[2] && !streamCookieOk(req, sessionId)) {
        const raw = decodeURIComponent(parts[2]);
        const ok = s.streamTokenHash && hashToken(raw) === s.streamTokenHash && Date.now() < (s.streamExpiresAt || 0);
        if (!ok) return sendJson(res, 403, { error: "stream token invalid or expired" });
        s.streamTokenHash = null; // single-use
        s.streamCookieHash = hashToken(crypto.randomBytes(32).toString("hex"));
        // Cookie lifetime = session lifetime (12h cap), not the token's
        // 5 min — see the note in hf-space/gate.js (a 5-min cookie turned
        // every transient socket drop into a permanent disconnect).
        s.streamCookieExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
        res.writeHead(302, {
          location: `/s/${sessionId}/`,
          "set-cookie": `${STREAM_COOKIE}=${s.streamCookieHash}; HttpOnly; Path=/s/; Max-Age=43200; SameSite=Lax`
        });
        return res.end();
      }
      if (!streamCookieOk(req, sessionId)) return sendJson(res, 403, { error: "stream token required" });
      return proxyHttp(req, res, s);
    }

    if (!authed(req)) return sendJson(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && url.pathname === "/containers") {
      return sendJson(res, 201, await launch(await readBody(req)));
    }
    if (req.method === "GET" && parts[0] === "containers" && parts[1]) {
      return sendJson(res, 200, { status: await containerStatus(parts[1]) });
    }
    if (req.method === "POST" && parts[0] === "containers" && parts[2] === "stop") {
      await stop(parts[1]);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && parts[0] === "containers" && parts[2] === "stream-token") {
      const s = sessions.get(parts[1]);
      if (!s) return sendJson(res, 404, { error: "session not found" });
      const body = await readBody(req);
      s.streamTokenHash = body.tokenHash;
      s.streamExpiresAt = new Date(body.expiresAt).getTime();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && parts[0] === "profiles" && parts[2] === "reconnect") {
      const pid = safeKey(parts[1]);
      if (!pid) return sendJson(res, 400, { error: "invalid profileId" });
      return sendJson(res, 200, { handle: await reconnect(pid) });
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, e.http || 500, { error: e.message || "internal error" });
  }
});

// WebSocket proxying for the streaming protocol (KasmVNC / noVNC).
server.on("upgrade", (req, socket, head) => {
  const parts = req.url.split("/").filter(Boolean);
  const sessionId = parts[0] === "s" ? parts[1] : null;
  const s = sessionId && sessions.get(sessionId);
  if (!s || !streamCookieOk(req, sessionId)) { socket.destroy(); return; }
  const upstreamPath = req.url.replace(/^\/s\/[^/]+/, "") || "/";
  const up = net.connect(s.hostPort, "127.0.0.1", () => {
    const headers = { ...req.headers, host: `127.0.0.1:${s.hostPort}` };
    const lines = [`${req.method} ${upstreamPath} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, () => {
  console.log(`SCB orchestrator listening on :${PORT} (image: ${IMAGE}, profiles: ${PROFILE_ROOT})`);
});
