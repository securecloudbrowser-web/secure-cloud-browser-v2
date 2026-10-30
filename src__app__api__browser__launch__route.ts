import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { getOrchestratorFor, isSessionInUse, BROWSER_LIMITS } from "@/lib/browser/orchestrator";
import { resolveOrchestratorBaseDetailed } from "@/lib/browser/host-endpoint";

// POST /api/browser/launch — start (or reconnect to) the signed-in user's
// cloud browser and return a one-time stream URL (raw token in the path,
// <= 5 minutes, single-use; only its hash is ever stored).
//
// Optional JSON body: { profileId } selects which of the caller's own
// profiles to launch. Without it, the caller's first profile is used.
// Profiles are NEVER created here — only the user creates them himself,
// via the profiles API / the dashboard form.
//
// Session lock (v19): when the profile's session is already live AND a
// stream screen is connected to it, a plain launch answers 409
// { error: "session_in_use", startedAt, streamConnected: true } and
// disturbs nothing — the panel asks the user what to do. The user can
// then retry with { mode: "attach" } (join the same session) or
// { force: true } (stop it and start fresh). Older orchestrators never
// report stream state, so the lock simply never triggers with them.
//
// The browser itself runs in a container on the user's Docker host via the
// orchestrator service. If no host is configured/reachable this returns an
// honest error — it never fakes a browser.

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Tolerant body parse: an empty or invalid body just means "no profileId".
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const profileId = body && typeof body.profileId === "string" ? body.profileId : undefined;
  // Session-lock choices from the panel (see the header note): force
  // replaces a live stream-connected session; mode "attach" joins it.
  const force = !!(body && body.force === true);
  const mode = body && body.mode === "attach" ? ("attach" as const) : undefined;

  // Resolve the host base dynamically: a fresh heartbeated tunnel URL
  // wins over the static ORCHESTRATOR_URL env var (the tunnel URL changes
  // on every host restart).
  const resolved = await resolveOrchestratorBaseDetailed();
  if (!resolved) {
    return NextResponse.json(
      { error: "Browser host is not connected yet. Start the host agent on the RDP server first — then this button will work." },
      { status: 503 }
    );
  }
  const orchestrator = getOrchestratorFor(resolved.base);

  // Profile resolution: an explicit profileId must belong to the caller
  // (404 otherwise — never leak that another user's profile exists).
  // Without one, fall back to the caller's first profile. There is NO
  // implicit/default profile: if the caller has none, say so honestly.
  const profile = profileId
    ? await prisma.browserProfile.findFirst({ where: { id: profileId, ownerId: userId } })
    : await prisma.browserProfile.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } });
  if (profileId && !profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  if (!profile) {
    return NextResponse.json(
      { error: "No profile yet — create your first profile, then start it." },
      { status: 400 }
    );
  }

  try {
    // Already running? Reconnect instead of launching a second container —
    // but never silently barge into a session whose screen is connected:
    // the panel must ask first (409), unless the user already chose
    // attach (join it) or force (replace it).
    const detailed = await orchestrator.reconnectWithSession(profile.id).catch(() => null);
    let handle = detailed?.handle ?? null;
    const liveSession = detailed?.session ?? null;
    if (handle && liveSession?.streamConnected && !force && mode !== "attach") {
      return NextResponse.json(
        { error: "session_in_use", startedAt: liveSession.startedAt, streamConnected: true },
        { status: 409 }
      );
    }
    if (handle && force) {
      // Explicit replacement: stop the live session, then fall through to
      // the fresh-launch path below.
      await orchestrator.stop(handle.sessionId).catch(() => undefined);
      handle = null;
    }
    let sessionRowId: string;
    if (handle) {
      // Live on the host. Reuse the newest open row for the token record,
      // or open one if the app lost track of the live session.
      const open = await prisma.browserSession.findFirst({
        where: { profileId: profile.id, status: { in: ["STARTING", "RUNNING"] } },
        orderBy: { startedAt: "desc" }
      });
      if (open) {
        sessionRowId = open.id;
        if (open.status !== "RUNNING") {
          await prisma.browserSession.update({
            where: { id: open.id },
            data: { status: "RUNNING", containerRef: handle.containerRef }
          });
        }
      } else {
        const created = await prisma.browserSession.create({
          data: { profileId: profile.id, startedById: userId, status: "RUNNING", containerRef: handle.containerRef }
        });
        sessionRowId = created.id;
      }
    } else {
      // Nothing live on the host, so any rows still marked open are stale:
      // the host stops sessions on its own when profiles switch, without
      // the app being told. Close them first — otherwise the token write
      // below can touch several RUNNING rows at once, and writing one
      // streamTokenHash to multiple rows violates its unique constraint
      // (seen live 2026-10-23, right after a host-side auto-stop).
      await prisma.browserSession.updateMany({
        where: { profileId: profile.id, status: { in: ["STARTING", "RUNNING"] } },
        data: { status: "STOPPED", stoppedAt: new Date(), streamTokenHash: null, streamTokenExpiresAt: null }
      });
      const session = await prisma.browserSession.create({
        data: { profileId: profile.id, startedById: userId, status: "STARTING" }
      });
      sessionRowId = session.id;
      try {
        handle = await orchestrator.launch({
          profileId: profile.id,
          storageKey: profile.storageKey,
          timezone: profile.timezone,
          locale: profile.locale,
          viewportWidth: profile.viewportWidth,
          viewportHeight: profile.viewportHeight,
          viewOnly: false,
          browser: profile.browser,
          force: force || undefined,
          mode
        });
      } catch (e) {
        // A session_in_use refusal is not a launch failure: no browser was
        // started for this attempt, so its row closes as STOPPED, not
        // ERROR, and the refusal reaches the panel as a 409 (outer catch).
        if (isSessionInUse(e)) {
          await prisma.browserSession.update({ where: { id: session.id }, data: { status: "STOPPED", stoppedAt: new Date() } });
        } else {
          await prisma.browserSession.update({ where: { id: session.id }, data: { status: "ERROR", stoppedAt: new Date() } });
        }
        throw e;
      }
      await prisma.browserSession.update({
        where: { id: session.id },
        data: { status: "RUNNING", containerRef: handle.containerRef }
      });
      await prisma.auditLog.create({ data: { actorId: userId, action: "browser.launch", targetType: "BrowserProfile", targetId: profile.id } });
      void BROWSER_LIMITS; // limits are sent to the orchestrator by the client
    }

    if (!handle) throw new Error("Browser launch produced no session handle.");
    const token = await orchestrator.issueStreamToken(handle.sessionId);
    // Write the token to exactly ONE row (see the stale-row note above).
    await prisma.browserSession.update({
      where: { id: sessionRowId },
      data: { streamTokenHash: token.tokenHash, streamTokenExpiresAt: token.expiresAt, lastActiveAt: new Date() }
    });

    // The stream is opened by the user's browser, so it needs the public
    // base. When the base came from a heartbeat it IS the current public
    // tunnel URL; otherwise keep the env public URL (env base fallback).
    const publicBase = resolved.fromHeartbeat
      ? resolved.base
      : (process.env.ORCHESTRATOR_PUBLIC_URL || resolved.base).replace(/\/$/, "");
    const streamUrl = `${publicBase}/s/${handle.sessionId}/${encodeURIComponent(token.rawToken)}`;
    return NextResponse.json({ streamUrl, status: "running" });
  } catch (e) {
    // The orchestrator's own session-lock refusal (a live session raced in
    // between the pre-check and the launch): forward it as the same 409
    // contract the panel understands.
    if (isSessionInUse(e)) {
      return NextResponse.json(
        { error: "session_in_use", startedAt: e.startedAt, streamConnected: e.streamConnected },
        { status: 409 }
      );
    }
    const message = e instanceof Error ? e.message : "Browser launch failed.";
    return NextResponse.json(
      { error: `Browser could not start: ${message}` },
      { status: 502 }
    );
  }
}
