// Secure Cloud Browser — HF Space gate (single-container "space mode").
//
// Runs inside a Hugging Face Docker Space on port 7860. Chromium + KasmVNC
// run in THIS SAME container on 127.0.0.1:6901 — there is no Docker daemon
// inside a Space, so this gate manages the local browser process directly
// and proxies its stream through the same single-use token gate the Docker
// orchestrator uses. The web app (Vercel) talks to it with the exact same
// API as the Docker orchestrator:
//
//   GET  /health                          -> { ok, docker: true, image }
//        ("docker: true" here means "this host can run a browser": the gate
//        and the browser binaries are present. The browser PROCESS is started
//        on demand by POST /containers.)
//   POST /containers                      -> restore profile, start browser
//   GET  /containers/:sessionId           -> { status }
//   POST /containers/:sessionId/stop      -> end session, stop browser, sync
//   POST /profiles/:profileId/reconnect   -> { handle | null }
//   POST /containers/:sessionId/stream-token { tokenHash, expiresAt }
//   GET  /s/:sessionId/:rawToken          -> single-use stream gate (cookie)
//
// Profile persistence: the Space disk is EPHEMERAL, so the browser profile
// (/profile) is synced to Supabase Storage through the web app, which hands
// out short-lived signed URLs (the service-role key never leaves Vercel):
// sync-in at launch (before the browser starts), sync-out every
// SYNC_INTERVAL_MIN minutes while running, on stop, and on SIGTERM
// (best effort — a sleeping Space may die without SIGTERM, so the periodic
// sync is the real safety net). Format: tar.gz of /profile with pure caches
// excluded. Supabase free storage caps files at 50 MB; if the archive grows
// past that, the upload fails and is logged honestly — the live profile
// keeps working regardless.
//
// v1 scope: one Space serves ONE profile at a time. If a different profile
// is requested while another is live, launch answers 409 honestly.
//
// Plain Node.js, built-ins only. Requires env:
//   ORCHESTRATOR_INTERNAL_TOKEN  (must match the Vercel env of the same name)
//   APP_URL                      (e.g. https://secure-cloud-browser.vercel.app)

"use strict";
const http = require("http");
const https = require("https");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT || 7860);
const TOKEN = process.env.ORCHESTRATOR_INTERNAL_TOKEN || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const PROFILE_DIR = process.env.PROFILE_DIR || "/profile";
const BROWSER_PORT = 6901;
// KasmVNC's web server demands HTTP Basic auth for its UI (the user created
// by the image's kasmvncpasswd step). 6901 is container-internal and every
// stream request already passed this gate's single-use token + cookie, so
// the gate injects the internal credential upstream instead of making the
// visitor's browser answer a second password prompt. Internal-only
// credential for a localhost service — not a user secret.
const KASM_BASIC = "Basic " + Buffer.from("browser:scbstream").toString("base64");
const BROWSER_USER = process.env.BROWSER_USER || "browser";
const STREAM_COOKIE = "scb_stream";
const SYNC_EVERY_MS = Number(process.env.SYNC_INTERVAL_MIN || 10) * 60 * 1000;
const TAR_EXCLUDES = [
  "chromium/Default/Cache",
  "chromium/Default/Code Cache",
  "chromium/Default/GPUCache",
  "chromium/Default/ShaderCache",
  "chromium/Default/GrShaderCache",
  "chromium/Default/DawnCache",
  "chromium/SingletonLock",
  "chromium/SingletonCookie",
  "chromium/SingletonSocket",
];

if (!TOKEN) {
  console.error("FATAL: ORCHESTRATOR_INTERNAL_TOKEN is not set. Refusing to start.");
  process.exit(1);
}
if (!APP_URL) {
  console.error("FATAL: APP_URL is not set. Refusing to start.");
  process.exit(1);
}

const sessions = new Map(); // sessionId -> { profileId, storageKey, streamTokenHash, streamExpiresAt, streamCookieHash, streamCookieExpiresAt }
let activeKey = null;   // storageKey the on-disk profile belongs to
let restoredKey = null; // storageKey restored from storage during this boot

// ---------- small process runner ----------------------------------------------
function run(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, stdin: "ignore" }, (err, stdout, stderr) => {
      if (err) reject(new Error(((stderr || stdout || err.message) || `${cmd} failed`).toString().trim().slice(0, 300)));
      else resolve((stdout || "").toString().trim());
    });
  });
}

// ---------- profile sync via the web app's signed URLs ------------------------
async function signedUrl(storageKey, op) {
  const res = await fetch(`${APP_URL}/api/browser/profile/sync-url`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ storageKey, op }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`sync-url ${op} -> HTTP ${res.status} ${detail.slice(0, 160)}`);
  }
  const data = await res.json();
  return data.url || null;
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    lib.get(u, (r) => {
      if (r.statusCode !== 200) return reject(new Error(`download HTTP ${r.statusCode}`));
      const out = fs.createWriteStream(dest);
      r.pipe(out);
      out.on("finish", () => out.close(resolve));
      out.on("error", reject);
    }).on("error", reject);
  });
}

function uploadFile(url, src) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const size = fs.statSync(src).size;
    const req = https.request(
      { method: "PUT", hostname: u.hostname, path: u.pathname + u.search,
        headers: { "content-type": "application/gzip", "content-length": size, "x-upsert": "true" } },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          if (r.statusCode >= 200 && r.statusCode < 300) resolve();
          else reject(new Error(`upload HTTP ${r.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
        });
      }
    );
    req.on("error", reject);
    fs.createReadStream(src).pipe(req);
  });
}

async function syncIn(storageKey) {
  const url = await signedUrl(storageKey, "download");
  if (!url) { console.log(`[sync] no saved profile for ${storageKey} — starting fresh`); return false; }
  const tmp = `/tmp/profile-in-${Date.now()}.tar.gz`;
  await downloadToFile(url, tmp);
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  await run("tar", ["-xzf", tmp, "-C", PROFILE_DIR], 120000);
  fs.unlinkSync(tmp);
  console.log(`[sync] profile for ${storageKey} restored from storage`);
  return true;
}

let syncingOut = false;
async function syncOut(storageKey) {
  if (syncingOut || !storageKey) return;
  syncingOut = true;
  const tmp = `/tmp/profile-out-${Date.now()}.tar.gz`;
  try {
    if (!fs.existsSync(path.join(PROFILE_DIR, "chromium"))) return;
    await run("tar", ["-czf", tmp, ...TAR_EXCLUDES.flatMap((e) => ["--exclude", e]), "-C", PROFILE_DIR, "chromium"], 120000);
    const mb = (fs.statSync(tmp).size / 1048576).toFixed(1);
    const url = await signedUrl(storageKey, "upload");
    if (!url) throw new Error("no upload URL");
    await uploadFile(url, tmp);
    console.log(`[sync] profile for ${storageKey} saved (${mb} MB)`);
  } catch (e) {
    console.error(`[sync] sync-out failed: ${e.message}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    syncingOut = false;
  }
}

// ---------- local browser process ----------------------------------------------
function browserUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: BROWSER_PORT, path: "/", timeout: 2500, headers: { authorization: KASM_BASIC } }, (r) => {
      r.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function startBrowser() {
  if (await browserUp()) return;
  // Stale X lock guard: if Xvnc died uncleanly (e.g. the kasmvncserver
  // "-kill" deadlock), /tmp/.X1-lock survives in the container layer and
  // the next kasmvncserver refuses to start ("...:1 is taken because of
  // /tmp/.X1-lock") even though nothing is listening — seen live after a
  // container restart 2026-10-22. browserUp() just proved no server is
  // up, so any lock present is stale by definition; remove it.
  await run("rm", ["-f", "/tmp/.X1-lock", "/tmp/.X11-unix/X1"], 5000).catch(() => {});
  await run("su", [BROWSER_USER, "-s", "/bin/bash", "-c",
    // KasmVNC 1.5 asks ONE interactive question on first run (desktop
    // environment; our xstartup is "manual") — answer it via stdin or the
    // server exits immediately. The write-user prompt is pre-answered by
    // the kasmvncpasswd step baked into the image.
    `printf '1\\n' | kasmvncserver :1 -websocketPort ${BROWSER_PORT} -SecurityTypes None`], 30000)
    .catch((e) => console.error(`[browser] start attempt: ${e.message}`));
  for (let i = 0; i < 30; i++) {
    if (await browserUp()) { console.log("[browser] up on :" + BROWSER_PORT); return; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("The browser did not come up on this host — check the Space logs.");
}

async function stopBrowser() {
  await run("su", [BROWSER_USER, "-s", "/bin/bash", "-c", "kasmvncserver -kill :1"], 15000).catch(() => {});
  await run("pkill", ["-f", "chromium"], 10000).catch(() => {});
}

// ---------- helpers --------------------------------------------------------------
function safeKey(v) {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v) ? v : null;
}
function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function sendJson(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
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

// ---------- sessions ---------------------------------------------------------------
async function launch(body) {
  const profileId = safeKey(body.profileId);
  const storageKey = safeKey(body.storageKey);
  if (!profileId || !storageKey) throw Object.assign(new Error("invalid profileId/storageKey"), { http: 400 });

  if (activeKey && activeKey !== storageKey) {
    // One browser at a time on this host. A launch for a different profile
    // stops whatever is live (saving its profile first) and switches.
    // This used to refuse with 409 "stop it first" — which stranded the
    // host whenever a user closed the tab without pressing Stop: their
    // session stayed "live" forever and every later start, from any
    // account, failed (the user-visible "runs once, then error" bug,
    // 2026-10-22). Auto-stopping is the right trade-off for a single-
    // browser free host; the displaced profile is synced out, not lost.
    for (const [sid, s] of [...sessions]) {
      if (s.storageKey === activeKey) sessions.delete(sid);
    }
    await stopBrowser();
    await syncOut(activeKey);
    activeKey = null;
    restoredKey = null;
  }

  if (restoredKey !== storageKey) {
    // wipe any leftovers from a previous profile before restoring this one
    fs.rmSync(path.join(PROFILE_DIR, "chromium"), { recursive: true, force: true });
    try { await syncIn(storageKey); }
    catch (e) { console.error(`[sync] sync-in failed: ${e.message} — starting fresh`); }
    restoredKey = storageKey;
  }
  activeKey = storageKey;

  await startBrowser();
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { profileId, storageKey, streamTokenHash: null, streamExpiresAt: 0 });
  return { sessionId, status: "running", containerRef: "hf-space" };
}

async function containerStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return "stopped";
  return (await browserUp()) ? "running" : "stopped";
}

async function stop(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) {
    await stopBrowser();
    await syncOut(s.storageKey);
  }
}

async function reconnect(profileId) {
  for (const [sessionId, s] of sessions) {
    if (s.profileId === profileId && (await browserUp())) {
      return { sessionId, status: "running", containerRef: "hf-space" };
    }
  }
  return null;
}

// ---------- stream gate ---------------------------------------------------------------
function streamCookieHashFrom(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(new RegExp(`${STREAM_COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

function streamCookieOk(req, sessionId) {
  const hash = streamCookieHashFrom(req);
  if (!hash) return false;
  const s = sessions.get(sessionId);
  return !!s && s.streamCookieHash === hash && Date.now() < (s.streamCookieExpiresAt || 0);
}

// The KasmVNC client dials its RFB websocket at the host ROOT (/websockify),
// not under /s/<session>/ — so a root upgrade is authenticated by looking up
// which live session the presented stream cookie belongs to.
function sessionByStreamCookie(req) {
  const hash = streamCookieHashFrom(req);
  if (!hash) return null;
  for (const s of sessions.values()) {
    if (s.streamCookieHash === hash && Date.now() < (s.streamCookieExpiresAt || 0)) return s;
  }
  return null;
}

function proxyHttp(req, res) {
  const upstreamPath = req.url.replace(/^\/s\/[^/]+/, "") || "/";
  const up = http.request(
    { host: "127.0.0.1", port: BROWSER_PORT, path: upstreamPath, method: req.method, headers: { ...req.headers, authorization: KASM_BASIC } },
    (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); }
  );
  up.on("error", () => { if (!res.headersSent) sendJson(res, 502, { error: "browser stream unreachable" }); });
  req.pipe(up);
}

// ---------- server -----------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, docker: true, image: "hf-space", publicBase: "" });
    }

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
        // The cookie is the stream session's credential — it must live as
        // long as the session (12h platform cap), NOT the token's 5 min.
        // At 5 min, any transient socket drop (tunnel hiccup, network
        // switch) became a permanent "Connection is closed": the client's
        // reconnect was rejected on the expired cookie (user report,
        // 2026-10-23). The token stays single-use and short-lived; the
        // cookie is only a hash in this map and dies with the session.
        s.streamCookieExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
        res.writeHead(302, {
          location: `/s/${sessionId}/`,
          // Path=/ (not /s/): the browser must also send this cookie with the
          // client's root-level /websockify upgrade — see sessionByStreamCookie.
          "set-cookie": `${STREAM_COOKIE}=${s.streamCookieHash}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax`,
        });
        return res.end();
      }
      if (!streamCookieOk(req, sessionId)) return sendJson(res, 403, { error: "stream token required" });
      return proxyHttp(req, res);
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

server.on("upgrade", (req, socket, head) => {
  const parts = req.url.split("/").filter(Boolean);
  const sessionId = parts[0] === "s" ? parts[1] : null;
  let upstreamPath;
  if (sessionId) {
    const s = sessions.get(sessionId);
    if (!s || !streamCookieOk(req, sessionId)) { socket.destroy(); return; }
    upstreamPath = req.url.replace(/^\/s\/[^/]+/, "") || "/";
  } else if (parts[0] === "websockify" && parts.length === 1) {
    // KasmVNC client connects to wss://<host>/websockify at the root.
    if (!sessionByStreamCookie(req)) { socket.destroy(); return; }
    upstreamPath = req.url;
  } else { socket.destroy(); return; }
  const up = net.connect(BROWSER_PORT, "127.0.0.1", () => {
    const headers = { ...req.headers, host: `127.0.0.1:${BROWSER_PORT}`, authorization: KASM_BASIC };
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

setInterval(() => { if (activeKey && sessions.size > 0) syncOut(activeKey); }, SYNC_EVERY_MS).unref();
process.on("SIGTERM", async () => { await syncOut(activeKey); process.exit(0); });

server.listen(PORT, () => {
  console.log(`SCB HF gate listening on :${PORT} (profile dir: ${PROFILE_DIR})`);
});
