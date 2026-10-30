import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { getOrchestratorFor, OrchestratorHttpError } from "@/lib/browser/orchestrator";
import { resolveOrchestratorBaseDetailed } from "@/lib/browser/host-endpoint";

// POST /api/browser/login-check { profileId } — sign-in ESTIMATE for the
// caller's own profile (v20 host feature). The host reads a COPY of the
// profile's cookie database and answers, per known site, only whether a
// session cookie is present. Cookie values never leave the PC. The
// panel labels the result as an estimate — a site can end a session
// server-side while its cookies remain on disk. A pre-v20 host answers
// 404, which becomes an honest "host purana hai" notice.

const HOST_OUTDATED = {
  error: "host_outdated",
  message: "Host purana hai — pehle PC par naya setup (v20) chalao, phir login check kaam karega."
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
    const result = await getOrchestratorFor(resolved.base).loginCheck(profile.id, profile.storageKey);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof OrchestratorHttpError && e.status === 404) {
      return NextResponse.json(HOST_OUTDATED, { status: 409 });
    }
    return NextResponse.json({ error: "Login check nahi ho saka — host ne jawab nahi diya." }, { status: 502 });
  }
}
