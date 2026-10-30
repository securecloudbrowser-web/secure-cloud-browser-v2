import bcrypt from "bcryptjs";

// Password hashing helper.
// v2 requires Argon2id (preferred) or bcrypt >= 12. This implementation uses
// bcryptjs at cost 12 today; the interface (hashPassword / verifyPassword) is
// the seam where an argon2 implementation drops in without touching callers.
// TODO Phase 1: switch to argon2id via the `argon2` package and re-hash on login.
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 10) throw new Error("Password must be at least 10 characters.");
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try { return await bcrypt.compare(plain, hash); } catch { return false; }
}
