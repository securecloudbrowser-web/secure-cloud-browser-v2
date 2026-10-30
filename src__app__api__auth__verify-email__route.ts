import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/tokens";

// GET /api/auth/verify-email?token=<raw>
// Consumes an email-verification token created at registration: looks it up
// by its SHA-256 hash, checks it is unused and unexpired, marks the user's
// email as verified, and shows a small confirmation page in the site design.

function page(title: string, message: string, ok: boolean): NextResponse {
  const accent = ok ? "#34d399" : "#f87171";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Secure Cloud Browser</title></head>
<body style="margin:0;font-family:Arial,sans-serif;background:#07070d;color:#ececf4;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
  <div style="max-width:440px;width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:16px;padding:36px 32px;text-align:center">
    <div style="font-size:34px;margin-bottom:10px">${ok ? "✅" : "⚠️"}</div>
    <h1 style="margin:0 0 10px;font-size:24px;color:${accent}">${title}</h1>
    <p style="margin:0 0 24px;color:#b9b9cc;line-height:1.55">${message}</p>
    <a href="/login" style="display:inline-block;background:#6d5cff;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:bold">Go to log in</a>
  </div>
</body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("token");
  if (!raw) return page("Invalid link", "This verification link is incomplete. Please use the link from your email.", false);

  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true }
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return page("Link expired or already used", "This verification link is no longer valid. If your email is still unverified, register-time links last 24 hours — contact support or wait for the resend option.", false);
  }

  await prisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  if (!row.user.emailVerifiedAt) {
    await prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  }
  await prisma.auditLog.create({ data: { actorId: row.userId, action: "auth.email_verified" } });

  return page("Email verified", "Your email address is verified. You can now log in to Secure Cloud Browser.", true);
}
