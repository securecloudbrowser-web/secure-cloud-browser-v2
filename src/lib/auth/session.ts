import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";

// Platform session cookies — v2 section 12:
// HttpOnly, SameSite=Lax, Secure in production, raw token NEVER in a URL.
// The DB stores only the SHA-256 hash (UserSession.tokenHash).
// Absolute expiry 12h (v2 Part A section 3).

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "scb_session";
const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;

export async function createSession(userId: string, meta?: { userAgent?: string; ipAddress?: string }) {
  const raw = generateRawToken();
  const expiresAt = new Date(Date.now() + ABSOLUTE_TTL_MS);
  await prisma.userSession.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt, userAgent: meta?.userAgent, ipAddress: meta?.ipAddress }
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
  return { expiresAt };
}

/** Returns the signed-in user id, or null. Revoked/expired sessions return null. */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = await prisma.userSession.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  return session.userId;
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    await prisma.userSession.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
  jar.delete(SESSION_COOKIE);
}

/** "Sign out all devices" — used by the security settings page (Phase 1 remaining UI). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}
