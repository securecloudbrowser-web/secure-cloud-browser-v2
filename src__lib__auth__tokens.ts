import { createHash, randomBytes, timingSafeEqual } from "crypto";

// Token helpers — v2 section 5/12: ALL tokens (session, password-reset,
// email-verification, invitation, stream) are stored as SHA-256 HASHES only.
// The raw token is returned to the caller exactly once and never persisted.

export function generateRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time comparison of a raw token against a stored hash. */
export function tokenMatchesHash(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(raw), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
