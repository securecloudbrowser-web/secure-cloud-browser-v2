import { NextResponse } from "next/server";
import { destroyCurrentSession, getSessionUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// POST /api/auth/logout — revokes the current session server-side and clears the cookie.
export async function POST() {
  const userId = await getSessionUserId();
  await destroyCurrentSession();
  if (userId) await prisma.auditLog.create({ data: { actorId: userId, action: "auth.logout" } });
  return NextResponse.json({ ok: true });
}
