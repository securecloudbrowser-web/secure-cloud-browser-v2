import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth/session";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";

// /api/browser/shares — LINK shares for the signed-in user's OWN profiles.
//
// A link share is a ProfileShare row with NO recipient: the raw token
// exists only in the link shown to the owner ONCE at creation; the DB
// stores its SHA-256 hash (ProfileShare.tokenHash), exactly like every
// other token in this app. The public /share/[token] page resolves the
// hash to show the share's state (valid / expired / revoked) — it never
// grants a stream by itself; launching still requires an authorized
// account session, so a leaked link alone opens no browser.
//
// Permission mapping (UI words -> schema enum):
//   "VIEW_ONLY"    -> VIEW_ONLY   (guest can watch, no input)
//   "FULL_CONTROL" -> INTERACTIVE (guest may interact)

const EXPIRY_HOURS: Record<string, number | null> = {
  "1h": 1,
  "24h": 24,
  "7d": 24 * 7,
  never: null
};

function shareView(s: {
  id: string;
  profileId: string;
  permission: string;
  allowDownloads: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  profile?: { name: string } | null;
}) {
  const state = s.revokedAt ? "revoked" : s.expiresAt && s.expiresAt < new Date() ? "expired" : "active";
  return {
    id: s.id,
    profileId: s.profileId,
    profileName: s.profile?.name ?? null,
    permission: s.permission === "INTERACTIVE" ? "FULL_CONTROL" : "VIEW_ONLY",
    allowDownloads: s.allowDownloads,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt,
    state
  };
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await prisma.profileShare.findMany({
    where: { ownerId: userId, tokenHash: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { profile: { select: { name: true } } }
  });
  return NextResponse.json({ shares: rows.map(shareView) });
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const profileId = body && typeof body.profileId === "string" ? body.profileId : "";
  if (!profileId) return NextResponse.json({ error: "Profile id is required." }, { status: 400 });

  const permissionUi = body?.permission;
  if (permissionUi !== "VIEW_ONLY" && permissionUi !== "FULL_CONTROL") {
    return NextResponse.json({ error: 'Permission must be "VIEW_ONLY" or "FULL_CONTROL".' }, { status: 400 });
  }
  const expiryKey = typeof body?.expiry === "string" ? body.expiry : "7d";
  if (!(expiryKey in EXPIRY_HOURS)) {
    return NextResponse.json({ error: 'Expiry must be one of "1h", "24h", "7d", "never".' }, { status: 400 });
  }

  // Ownership: the profile must belong to the caller (404 otherwise).
  const profile = await prisma.browserProfile.findFirst({ where: { id: profileId, ownerId: userId } });
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const hours = EXPIRY_HOURS[expiryKey];
  const raw = generateRawToken();
  const share = await prisma.profileShare.create({
    data: {
      profileId: profile.id,
      ownerId: userId,
      recipientId: null,
      tokenHash: hashToken(raw),
      permission: permissionUi === "FULL_CONTROL" ? "INTERACTIVE" : "VIEW_ONLY",
      allowDownloads: body?.allowDownloads === true,
      expiresAt: hours === null ? null : new Date(Date.now() + hours * 3600_000)
    },
    include: { profile: { select: { name: true } } }
  });
  await prisma.auditLog.create({
    data: { actorId: userId, action: "share.create", targetType: "BrowserProfile", targetId: profile.id }
  });

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  // The raw token is returned exactly once, here — it is never stored.
  return NextResponse.json({ share: shareView(share), shareUrl: `${appUrl}/share/${raw}` }, { status: 201 });
}

export async function DELETE(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Share id is required." }, { status: 400 });

  const share = await prisma.profileShare.findFirst({ where: { id, ownerId: userId } });
  if (!share) return NextResponse.json({ error: "Share not found." }, { status: 404 });

  await prisma.profileShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({
    data: { actorId: userId, action: "share.revoke", targetType: "BrowserProfile", targetId: share.profileId }
  });
  return NextResponse.json({ ok: true });
}
