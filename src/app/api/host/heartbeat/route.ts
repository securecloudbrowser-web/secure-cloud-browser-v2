import { NextResponse } from "next/server";
import { recordHostHeartbeat } from "@/lib/browser/host-endpoint";

// POST /api/host/heartbeat { url, prevEnd? } — the RDP host agent reports
// its current tunnel URL so the app can reach the orchestrator even
// though the free tunnel URL changes on every host restart. The v20
// agent also sends prevEnd ("abrupt" | "clean"): how its previous run
// ended — see the validation below.
//
// Auth is the shared internal token in the `x-internal-token` header (the
// PC agent is not a signed-in user, so there is deliberately no session
// check). Only tunnel URLs of the two transports the PC agent uses are
// accepted: https://*.trycloudflare.com (Cloudflare quick tunnel) and
// https://*.ts.net (Tailscale Funnel — a stable address that does not
// bot-block cloud clients the way the free Cloudflare tunnel does).
//
// Reachability probe (additive): after a heartbeat is recorded, when the
// reported URL is a *.ts.net URL this route may probe `${url}/health`
// itself and report the outcome back in the response as `probeOk`
// (true = the site can reach the host right now, false = it cannot).
// The PC agent uses that signal to heal its own tunnel when heartbeats
// land but the site still cannot reach it (the recurring Funnel wedge).
// `probeOk` is ABSENT when no probe ran — trycloudflare URLs are never
// probed (cloud probes of those are bot-blocked by design), and probes
// are throttled (see PROBE_MIN_INTERVAL_MS). The probe never breaks the
// heartbeat: any failure is swallowed into probeOk: false.

// Probe at most once per ~50 s across heartbeats. The timestamp is
// module-level, so on serverless each warm instance keeps its own — the
// throttle is therefore approximate (a cold instance may probe a little
// sooner than 50 s after another instance did). That is acceptable: the
// probe is a cheap read-only health check and the contract only needs
// "roughly once a minute at most", not an exact global lock.
const PROBE_MIN_INTERVAL_MS = 50_000;
const PROBE_TIMEOUT_MS = 6000;
let lastProbeAtMs = 0;

// One reachability probe of the host's /health, mirroring the status
// route's health check: Bearer internal token, no caching, hard timeout.
// Healthy = HTTP ok AND, when the body parses as a JSON object, its
// `ok` field is exactly true. Any error (network, timeout, bad status)
// is simply "not reachable" — this helper never throws.
async function probeHostHealth(base: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (!res.ok) return false;
    const body: unknown = await res.json().catch(() => undefined);
    if (body !== undefined && body !== null && typeof body === "object") {
      return (body as { ok?: unknown }).ok === true;
    }
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const expected = process.env.ORCHESTRATOR_INTERNAL_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "Internal token is not configured on the server." }, { status: 500 });
  }
  if (req.headers.get("x-internal-token") !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || url.length === 0) {
    return NextResponse.json({ error: "Body must be JSON with a url string." }, { status: 400 });
  }

  // prevEnd (v20 agent, additive): how the host's previous run ended.
  // Only the exact strings "abrupt" / "clean" are accepted. A body with
  // NO prevEnd field (older agent) leaves the stored value untouched; a
  // present-but-unusable value stores null (unknown).
  let prevEnd: string | null | undefined;
  if (body !== null && typeof body === "object" && "prevEnd" in body) {
    const raw = (body as { prevEnd?: unknown }).prevEnd;
    prevEnd = raw === "abrupt" || raw === "clean" ? raw : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "url is not a valid URL." }, { status: 400 });
  }
  const host = parsed.hostname;
  const allowedHost = host.endsWith(".trycloudflare.com") || host.endsWith(".ts.net");
  if (parsed.protocol !== "https:" || !allowedHost) {
    return NextResponse.json({ error: "url must be an https://*.trycloudflare.com or https://*.ts.net URL." }, { status: 400 });
  }

  await recordHostHeartbeat(url, prevEnd);

  // Reachability probe (see the header comment): only for ts.net URLs,
  // at most once per PROBE_MIN_INTERVAL_MS, and fully failure-isolated —
  // the heartbeat has already been recorded and always answers ok:true.
  // `probeOk` is added to the response only when a probe actually ran.
  const payload: { ok: true; probeOk?: boolean } = { ok: true };
  const nowMs = Date.now();
  if (host.endsWith(".ts.net") && nowMs - lastProbeAtMs >= PROBE_MIN_INTERVAL_MS) {
    lastProbeAtMs = nowMs;
    payload.probeOk = await probeHostHealth(url.replace(/\/+$/, ""), expected);
  }
  return NextResponse.json(payload);
}
