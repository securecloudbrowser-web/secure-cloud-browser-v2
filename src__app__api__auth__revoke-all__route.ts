import { NextResponse } from "next/server";
import { getSessionUserId, revokeAllSessions } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// POST /api/auth/revoke-all — "Sign out all devices": revokes every
// session row for the signed-in user (the current cookie stops working
// too, so the client sends the user back to /login afterwards).
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  await revokeAllSessions(userId);
  await prisma.auditLog.create({ data: { actorId: userId, action: "auth.revoke_all_sessions" } });
  return NextResponse.json({ ok: true });
}
