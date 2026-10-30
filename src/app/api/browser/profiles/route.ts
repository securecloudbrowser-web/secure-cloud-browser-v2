import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { BROWSER_LIMITS, getOrchestratorFor } from "@/lib/browser/orchestrator";
import { resolveOrchestratorBase } from "@/lib/browser/host-endpoint";

// /api/browser/profiles — the signed-in user's OWN browser profiles.
// GET lists them; POST creates one (name + browser engine choice), subject
// to BROWSER_LIMITS.maxProfilesPerUser; PATCH edits one (name and/or
// browser — never storageKey/ownerId); DELETE removes one, with a
// best-effort cleanup on the host first. Profiles are strictly per-user:
// every query is scoped by ownerId, so one user can never see, create,
// edit or delete profiles for another. (Sharing profiles with other
// people is a separate feature and is NOT part of this route.)

// Optional purpose label ("ye profile kis kaam ke liye hai"): free text,
// max 200 chars; blank/whitespace-only is stored as null (no label).
const DESCRIPTION_MAX = 200;
function cleanDescription(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > DESCRIPTION_MAX) return { ok: false };
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await prisma.browserProfile.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json({
    profiles: rows.map((p) => ({ id: p.id, name: p.name, browser: p.browser, description: p.description ?? null, createdAt: p.createdAt }))
  });
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const name = body && typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 40) {
    return NextResponse.json({ error: "Profile name must be 1–40 characters." }, { status: 400 });
  }
  const browser = body?.browser;
  if (browser !== "chromium" && browser !== "firefox") {
    return NextResponse.json({ error: 'Browser must be "chromium" or "firefox".' }, { status: 400 });
  }
  // Optional purpose label; absent is fine, malformed is a 400.
  let description: string | null = null;
  if (body && body.description !== undefined && body.description !== null) {
    const cleaned = cleanDescription(body.description);
    if (!cleaned.ok) {
      return NextResponse.json({ error: `Profile description must be text of at most ${DESCRIPTION_MAX} characters.` }, { status: 400 });
    }
    description = cleaned.value;
  }

  const count = await prisma.browserProfile.count({ where: { ownerId: userId } });
  if (count >= BROWSER_LIMITS.maxProfilesPerUser) {
    return NextResponse.json(
      { error: `Profile limit reached — you can have at most ${BROWSER_LIMITS.maxProfilesPerUser} profiles.` },
      { status: 400 }
    );
  }

  // storageKey is unique per profile: user prefix + 8 lowercase hex chars,
  // so additional profiles never collide with the default profile's
  // `u-<userId>` key.
  const storageKey = `u-${userId}-${randomBytes(4).toString("hex")}`;
  const profile = await prisma.browserProfile.create({
    data: { ownerId: userId, name, browser, description, storageKey }
  });
  return NextResponse.json(
    { id: profile.id, name: profile.name, browser: profile.browser, description: profile.description ?? null, createdAt: profile.createdAt },
    { status: 201 }
  );
}

export async function PATCH(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Profile id is required." }, { status: 400 });

  // At least one editable field must be provided; validate each provided
  // field exactly like POST does. storageKey and ownerId are NEVER part of
  // an edit — a profile keeps its stored data and its owner, always.
  const hasName = body !== null && typeof body.name === "string";
  const hasBrowser = body !== null && typeof body.browser === "string";
  const hasDescription = body !== null && typeof body.description === "string";
  if (!hasName && !hasBrowser && !hasDescription) {
    return NextResponse.json({ error: "Nothing to update — provide a name, a browser and/or a description." }, { status: 400 });
  }
  const data: { name?: string; browser?: string; description?: string | null } = {};
  if (hasName) {
    const name = (body.name as string).trim();
    if (name.length < 1 || name.length > 40) {
      return NextResponse.json({ error: "Profile name must be 1–40 characters." }, { status: 400 });
    }
    data.name = name;
  }
  if (hasBrowser) {
    const browser = body.browser as string;
    if (browser !== "chromium" && browser !== "firefox") {
      return NextResponse.json({ error: 'Browser must be "chromium" or "firefox".' }, { status: 400 });
    }
    data.browser = browser;
  }
  if (hasDescription) {
    const cleaned = cleanDescription(body.description);
    if (!cleaned.ok) {
      return NextResponse.json({ error: `Profile description must be text of at most ${DESCRIPTION_MAX} characters.` }, { status: 400 });
    }
    data.description = cleaned.value; // empty string clears the label (null)
  }

  // Ownership: the profile must belong to the caller (404 otherwise —
  // never leak that another user's profile exists).
  const existing = await prisma.browserProfile.findFirst({ where: { id, ownerId: userId } });
  if (!existing) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const profile = await prisma.browserProfile.update({ where: { id: existing.id }, data });
  return NextResponse.json({ id: profile.id, name: profile.name, browser: profile.browser, description: profile.description ?? null, createdAt: profile.createdAt });
}

export async function DELETE(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Profile id is required." }, { status: 400 });

  // Ownership: the profile must belong to the caller (404 otherwise).
  const profile = await prisma.browserProfile.findFirst({ where: { id, ownerId: userId } });
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  // (a) Best-effort host cleanup — every error is swallowed. The host may
  // be offline or running older code without these endpoints; the delete
  // must still succeed, so nothing here is allowed to fail the request.
  try {
    const base = await resolveOrchestratorBase();
    if (base) {
      try {
        const orchestrator = getOrchestratorFor(base);
        const handle = await orchestrator.reconnect(profile.id).catch(() => null);
        if (handle) await orchestrator.stop(handle.sessionId).catch(() => {});
      } catch {
        // host unreachable — ignore
      }
      try {
        await fetch(`${base}/profiles/delete`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.ORCHESTRATOR_INTERNAL_TOKEN || ""}`
          },
          body: JSON.stringify({ storageKey: profile.storageKey, profileId: profile.id })
        });
      } catch {
        // host offline — ignore
      }
    }
  } catch {
    // base resolution failed — ignore
  }

  // (b) Remove the profile row. Its BrowserSession rows cascade on delete
  // (see the schema), so no orphan sessions are left behind.
  await prisma.browserProfile.delete({ where: { id: profile.id } });
  return NextResponse.json({ ok: true });
}
