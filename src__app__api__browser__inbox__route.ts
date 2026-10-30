import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { getOrchestratorFor, OrchestratorHttpError } from "@/lib/browser/orchestrator";
import { resolveOrchestratorBaseDetailed } from "@/lib/browser/host-endpoint";

// POST /api/browser/inbox — multipart form: { profileId, file }.
// Sends a file into the caller's own profile on the RDP host (v20 host
// feature): it lands in the profile's Inbox folder, which the browser's
// file picker can reach (linked into the browser user's home when the
// container starts). Works whether the profile is running or stopped —
// a stopped profile finds the file at its next start. 25 MB cap,
// enforced here AND on the host. A pre-v20 host answers 404, which
// becomes an honest "host purana hai" notice.

const MAX_BYTES = 25 * 1024 * 1024;
const HOST_OUTDATED = {
  error: "host_outdated",
  message: "Host purana hai — pehle PC par naya setup (v20) chalao, phir file bhejna kaam karega."
};

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const profileId = form && typeof form.get("profileId") === "string" ? (form.get("profileId") as string) : undefined;
  const file = form ? form.get("file") : null;
  if (!profileId || !(file instanceof File)) {
    return NextResponse.json({ error: "profileId aur file dono chahiye." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", message: "File bohat bari hai — zyada se zyada 25 MB." }, { status: 413 });
  }

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
    const data = new Uint8Array(await file.arrayBuffer());
    const result = await getOrchestratorFor(resolved.base).uploadInbox(profile.id, profile.storageKey, file.name || "file", data);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof OrchestratorHttpError) {
      if (e.status === 404) return NextResponse.json(HOST_OUTDATED, { status: 409 });
      if (e.status === 413) {
        return NextResponse.json({ error: "file_too_large", message: "File bohat bari hai — zyada se zyada 25 MB." }, { status: 413 });
      }
    }
    return NextResponse.json({ error: "File nahi bheji ja saki — host ne jawab nahi diya." }, { status: 502 });
  }
}
