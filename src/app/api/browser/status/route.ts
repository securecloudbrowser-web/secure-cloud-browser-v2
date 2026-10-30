import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { getOrchestratorFor, type ProfileSessionInfo } from "@/lib/browser/orchestrator";
import { getHostLastSeenAt, getHostPrevEnd, resolveOrchestratorBase } from "@/lib/browser/host-endpoint";

// GET /api/browser/status — is the browser host connected, and which of the
// signed-in user's browsers are running? Honest states only: when no
// orchestrator is configured this says so (configured: false) instead of
// pretending. `profiles` lists every profile the caller owns with its own
// running flag; the top-level `running` is true when ANY profile runs.

// The host is reached through a free tunnel whose first hit can be slow or
// stall, so the health check uses a generous timeout and one retry — a
// single slow response must not brand a healthy host "offline" (this exact
// failure happened on 2026-10-23: the gate answered curl in ~0.5s while
// this check kept timing out at 5s and the panel showed "host offline").
async function fetchHealth(base: string): Promise<{ hostOnline: boolean; dockerReady: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/health`, {
        headers: { authorization: `Bearer ${process.env.ORCHESTRATOR_INTERNAL_TOKEN || ""}` },
        signal: AbortSignal.timeout(12000)
      });
      if (res.ok) {
        const health = await res.json();
        return { hostOnline: true, dockerReady: !!health.docker };
      }
    } catch {
      // network error, timeout, or a non-JSON answer — retry once below
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  return { hostOnline: false, dockerReady: false };
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Every profile the caller owns (creation order). Running flags are
  // filled in below only when the host actually answers.
  const rows = await prisma.browserProfile.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" }
  });
  const profiles = rows.map((p) => ({
    id: p.id,
    name: p.name,
    browser: p.browser,
    description: p.description ?? null,
    running: false,
    // Additive session truth (v19 orchestrator): filled in below when the
    // host reports it; stays null with an older orchestrator and the panel
    // simply renders nothing extra.
    session: null as ProfileSessionInfo | null
  }));


  // Last heartbeat time (additive field): the dashboard shows it as
  // "Host aakhri dafa online tha: …" whenever the host is offline.
  const lastSeen = await getHostLastSeenAt();
  const hostLastSeenAt = lastSeen ? lastSeen.toISOString() : null;

  // Previous-run classification (additive field, v20 agent): "abrupt" |
  // "clean" | null. The panel shows it as one small line while the host
  // is online; null/absent with an older agent renders nothing.
  const hostPrevEnd = await getHostPrevEnd();

  // The host's tunnel URL changes on every restart: prefer a fresh
  // heartbeated URL, fall back to the ORCHESTRATOR_URL env var.
  const base = await resolveOrchestratorBase();
  if (!base) {
    return NextResponse.json({ configured: false, hostOnline: false, running: false, profiles, hostLastSeenAt, hostPrevEnd });
  }

  const { hostOnline, dockerReady } = await fetchHealth(base);

  if (hostOnline && dockerReady && rows.length > 0) {
    const orchestrator = getOrchestratorFor(base);
    // One reconnect check per profile, in parallel; a failed check means
    // "not running" for that profile only. The v19 orchestrator also
    // reports the session truth (since when, screen connected?) — older
    // orchestrators return no session and the field stays null.
    const details = await Promise.all(
      rows.map((p) =>
        orchestrator
          .reconnectWithSession(p.id)
          .catch(() => ({ handle: null, session: null }))
      )
    );
    details.forEach((d, i) => {
      profiles[i].running = !!d.handle;
      profiles[i].session = d.session;
    });
  }

  const running = profiles.some((p) => p.running);
  return NextResponse.json({ configured: true, hostOnline, dockerReady, running, profiles, hostLastSeenAt, hostPrevEnd });
}
