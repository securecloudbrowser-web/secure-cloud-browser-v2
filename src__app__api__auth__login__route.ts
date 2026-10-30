import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

// POST /api/auth/login — REAL Prisma-backed implementation.
// NOTE (honest gaps, Phase 1 remaining): rate limiting (5/min/IP) and the
// lockout backoff counter, TOTP 2FA challenge, and breached-password check
// are NOT yet implemented — see README PHASE 1 STATUS.
const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Same error for unknown email and wrong password (no account enumeration).
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    if (user) {
      await prisma.securityEvents.create({ data: { userId: user.id, type: "LOGIN_FAILURE" } });
    }
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json({ error: "Account temporarily locked. Try again later." }, { status: 423 });
  }

  await createSession(user.id, { userAgent: req.headers.get("user-agent") || undefined });
  await prisma.securityEvents.create({ data: { userId: user.id, type: "LOGIN_SUCCESS" } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "auth.login" } });

  return NextResponse.json({ id: user.id, email: user.email, emailVerified: !!user.emailVerifiedAt });
}
