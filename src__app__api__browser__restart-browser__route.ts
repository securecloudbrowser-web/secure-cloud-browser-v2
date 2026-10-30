import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { getOrchestratorFor, OrchestratorHttpError } from "@/lib/browser/orchestrator";
import { resolveOrchestratorBaseDetailed } from "@/lib/browser/host-endpoint";

// POST /api/browser/restart-browser { profileId } — restart ONLY the
// browser inside the profile's already-running container on the RDP host
// (v20 host feature): same session, same profile data, tabs restore.
// The escape hatch for "the stream shows an empty desktop / Chrome is
// gone" without a full Stop/Start. The profile must belong to the
// caller. A pre-v20 host answers 404 for the endpoint, which becomes an
// honest "host purana hai" notice rather than a bare failure.

const HOST_OUTDATED = {
  error: "host_outdated",
  message: "Host purana hai — pehle PC par naya setup (v20) chalao, phir ye button kaam karega."
};

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const profileId = body && typeof body.profileId === "string" ? body.profileId : undefined;
  if (!profileId) return NextResponse.json({ error: "profileId is required." }, { status: 400 });

  const resolved = await resolveOrchestratorBaseDetailed();
  if (!resolved) {
    return NextResponse.json(
      { error: "Browser host is not connected yet. Start the host agent on the RDP server first — then this button will work." },
      { status: 503 }
    );
  }

  const profile = await prisma.browserProfile.findFirst({ where: { id: profileId, ownerId: userId } });
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  try {
    const result = await getOrchestratorFor(resolved.base).restartBrowser(profile.id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof OrchestratorHttpError) {
      if (e.status === 404) return NextResponse.json(HOST_OUTDATED, { status: 409 });
      if (e.status === 409) {
        return NextResponse.json(
          { error: "no_live_session", message: "Is profile ka koi session chal nahi raha — pehle browser Start karo." },
          { status: 409 }
        );
      }
    }
    return NextResponse.json({ error: "Browser restart nahi ho saka — host ne jawab nahi diya." }, { status: 502 });
  }
}
