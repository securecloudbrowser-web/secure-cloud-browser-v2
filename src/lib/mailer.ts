import nodemailer from "nodemailer";

// Mailer — verification emails via Gmail SMTP (free tier, no domain needed).
// Config comes from env only:
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465),
//   SMTP_USER (the Gmail address), SMTP_PASS (a Google App Password),
//   MAIL_FROM (defaults to SMTP_USER), APP_URL (public base URL of the site).
//
// If SMTP_USER / SMTP_PASS are missing or still placeholders, sending is
// SKIPPED (returns false) so registration never breaks — the verification
// token is still stored and a link can be sent later. The raw token is
// placed only inside the email link; it is never logged anywhere.

const PLACEHOLDERS = new Set(["", "PASTE-GMAIL-HERE", "PASTE-APP-PASSWORD-HERE"]);

export function mailerConfigured(): boolean {
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  return !PLACEHOLDERS.has(user) && !PLACEHOLDERS.has(pass);
}

function createTransport() {
  const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT ?? "465");
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

export async function sendVerificationEmail(to: string, rawToken: string): Promise<boolean> {
  if (!mailerConfigured()) return false;
  const base = process.env.APP_URL ?? "https://secure-cloud-browser.vercel.app";
  const link = `${base}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  const fromAddress = process.env.MAIL_FROM ?? process.env.SMTP_USER;
  await createTransport().sendMail({
    from: `Secure Cloud Browser <${fromAddress}>`,
    to,
    subject: "Verify your email — Secure Cloud Browser",
    text: [
      "Welcome to Secure Cloud Browser.",
      "",
      "Confirm your email address by opening this link (valid for 24 hours):",
      link,
      "",
      "If you did not create this account, you can safely ignore this email."
    ].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;background:#0b0b12;color:#e8e8f0;padding:32px;border-radius:12px;max-width:520px;margin:0 auto">
  <h2 style="margin:0 0 8px">Verify your email</h2>
  <p style="color:#b9b9cc;margin:0 0 20px">Welcome to Secure Cloud Browser. Confirm your email address to finish setting up your account. This link is valid for 24 hours.</p>
  <a href="${link}" style="display:inline-block;background:#6d5cff;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Verify my email</a>
  <p style="color:#8a8aa0;font-size:13px;margin:20px 0 0">If the button does not work, copy this link into your browser:<br>${link}</p>
  <p style="color:#8a8aa0;font-size:13px;margin:12px 0 0">If you did not create this account, you can safely ignore this email.</p>
</div>`
  });
  return true;
}
