import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { getOrchestratorFor } from "@/lib/browser/orchestrator";
import { resolveOrchestratorBase } from "@/lib/browser/host-endpoint";

// POST /api/browser/stop — stop the signed-in user's running browser.
// The profile (cookies/logins) stays on the host's disk; only the live
// container stops.
//
// Optional JSON body: { profileId } selects which of the caller's own
// profiles to stop. Without it, the caller's first profile is used.

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Same dynamic base resolution as launch/status: fresh heartbeat first,
  // env var fallback.
  const base = await resolveOrchestratorBase();
  if (!base) {
    return NextResponse.json({ error: "Browser host is not connected yet." }, { status: 503 });
  }

  // Tolerant body parse: an empty or invalid body just means "no profileId".
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const profileId = body && typeof body.profileId === "string" ? body.profileId : undefined;

  // Same resolution rule as launch: an explicit profileId must belong to
  // the caller (404 otherwise); absent → the caller's first profile.
  const profile = profileId
    ? await prisma.browserProfile.findFirst({ where: { id: profileId, ownerId: userId } })
    : await prisma.browserProfile.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } });
  if (profileId && !profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  if (!profile) return NextResponse.json({ ok: true, status: "stopped" });

  const orchestrator = getOrchestratorFor(base);
  const handle = await orchestrator.reconnect(profile.id).catch(() => null);
  if (handle) await orchestrator.stop(handle.sessionId).catch(() => undefined);

  await prisma.browserSession.updateMany({
    where: { profileId: profile.id, status: { in: ["STARTING", "RUNNING"] } },
    data: { status: "STOPPED", stoppedAt: new Date() }
  });
  await prisma.auditLog.create({ data: { actorId: userId, action: "browser.stop", targetType: "BrowserProfile", targetId: profile.id } });
  return NextResponse.json({ ok: true, status: "stopped" });
}
