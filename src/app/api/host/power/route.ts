import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { hostPowerConfigured, getCodespaceState, startCodespace, stopCodespace } from "@/lib/github-host";

// GET /api/host/power — is one-click wake/sleep set up, and what is the
// demo host's power state right now (asked from GitHub, never guessed)?
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!hostPowerConfigured()) {
    return NextResponse.json({ configured: false, state: null });
  }
  const state = await getCodespaceState();
  return NextResponse.json({ configured: true, state });
}

// POST /api/host/power { action: "wake" | "sleep" } — start or stop the
// demo host's Codespace. Signed-in users only; the GitHub token never
// leaves the server.
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!hostPowerConfigured()) {
    return NextResponse.json({ error: "Host wake/sleep is not set up yet." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.action === "wake") {
    const r = await startCodespace();
    return NextResponse.json(
      { ok: r.ok, state: r.state, error: r.ok ? undefined : "GitHub did not accept the wake request." },
      { status: r.ok ? 200 : 502 }
    );
  }
  if (body?.action === "sleep") {
    const r = await stopCodespace();
    return NextResponse.json(
      { ok: r.ok, state: r.state, error: r.ok ? undefined : "GitHub did not accept the sleep request." },
      { status: r.ok ? 200 : 502 }
    );
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
