# Secure Cloud Browser & Account Sharing Platform — v2

> **v2 (Stitch redesign, RDP host):** the UI follows the Google Stitch "Secure Cloud Browser Platform" design
> (palette #0B0F1A / #6366F1 / #06B6D4 / #8B5CF6, Inter + JetBrains Mono, sidebar app shell).
> In v2 the browser host is an **RDP server** — NOT the user's PC and NOT a Codespace.
> The v1 Codespace Wake/Sleep code (`src/lib/github-host.ts`, `/api/host/power`) is kept in the
> tree for reference only and is **not used by any v2 page**.
> Profile limit is 5 per user. Link sharing lives at `/dashboard/shares` + `/share/[token]`
> (ProfileShare rows with hashed tokens — see `src/app/api/browser/shares/route.ts`).

A persistent cloud Chrome (Chromium + KasmVNC) that users open from any device,
with owner-controlled, password-free sharing of browser access.
Design source of truth: `../UPDATED_PROMPT_v2.md` (Part B + Phase gates).

> **Deployment (updated — free stack is now primary):** the web app + database run
> FREE on **GitHub (code/CI) + Vercel (app hosting) + Supabase (PostgreSQL)** —
> full walkthrough in [`docs/FREE_STACK.md`](docs/FREE_STACK.md).
> One hard limit: the **persistent Chromium browser containers cannot run on that
> stack** (no Docker, no persistent disk, no long-lived processes there). The
> browser itself needs ONE Docker host — an Oracle Cloud Always Free VM or your
> own PC + tunnel — pointed to by `ORCHESTRATOR_URL` (see FREE_STACK.md).
> This app still **cannot** run on InfinityFree or any shared PHP hosting
> (no Docker, Node, PostgreSQL, or WebSockets there).

## Setup (development)

```bash
cp .env.example .env        # fill in values locally — never commit a real .env
npm install
# Start Postgres + Redis (needs Docker), or point DATABASE_URL at your own Postgres:
docker compose up -d postgres redis
npx prisma migrate dev      # creates all tables from prisma/schema.prisma
npm run dev                 # http://localhost:3000
```

## Production — free stack (primary path)

Follow [`docs/FREE_STACK.md`](docs/FREE_STACK.md) step by step:
1. Push this project to a GitHub repository.
2. Create a free Supabase project; copy its **pooled** connection string into
   `DATABASE_URL` and its **direct** string into `DIRECT_URL` (plus the API
   keys) as **Vercel** environment variables — never into committed files.
3. Import the repo in Vercel (`vercel.json` is already configured); the GitHub
   Actions workflow in `.github/workflows/deploy.yml` checks every push and
   deploys only when the Vercel secrets are set (it fails loudly otherwise).
4. Run `npx prisma migrate dev` once from your machine against Supabase
   (DIRECT_URL) to create the tables.
5. Add the RDP browser host (orchestrator in `../orchestrator/`, browser-host
   gate in `../browser-host/`, image in `browser-image/`) and set
   `ORCHESTRATOR_URL` in Vercel to it — until then, launching a browser
   honestly reports "not available yet".

## Production — VPS (alternative outline — Phase 4 gate not yet passed)

1. Rent a VPS (min ~4 vCPU / 8 GB RAM for a few concurrent browsers).
2. Put DB + profile volumes on encrypted storage; profile dirs mode `0700`.
3. `docker compose up -d` with a real domain in `Caddyfile` (HTTPS via Caddy/Let's Encrypt).
4. Grant the app DB role only INSERT + SELECT on `"AuditLog"` (append-only audit trail).
5. Daily encrypted backup of the DB + profile volumes, 7-day retention; test a restore.
6. Set a real SMTP/Resend config — production must fail loudly without email.

## Troubleshooting

- **`npm run dev` works but login fails:** Postgres isn't running or `DATABASE_URL` is wrong.
- **"Browser streaming is NOT available yet":** expected in Phase 1 — no orchestrator
  service exists yet and `ORCHESTRATOR_URL` unset means the stub refuses to launch.
- **External site asks for verification / blocks login:** normal for datacenter IPs.
  The platform never bypasses CAPTCHA/MFA; sign in manually inside the browser.

---

## PHASE 1 STATUS (honest — per v2 §14: nothing is "done" unless implemented AND tested)

### Implemented (code written; see "Verified" below for what was actually run)
- Next.js + React + TypeScript + Tailwind app skeleton: root layout, landing page
  (incl. the external-site warning from v2 Part A §4), login/register pages,
  dashboard shell with honest empty states (no fake data).
- `prisma/schema.prisma` with ALL §11 tables: Users, UserSessions, BrowserProfiles,
  BrowserSessions, ProfileShares, Invitations, AccessPermissions, AuditLogs,
  PasswordResetTokens, EmailVerificationTokens, SecurityEvents — UUID ids, ownerId
  FKs, indexes, cascade rules, hash-only token fields, share permission/expiry/revokedAt.
- Auth foundation in `src/lib/auth/`: bcrypt(12) password helper behind an interface
  (argon2id migration seam noted), SHA-256 token-hash helper with constant-time
  compare, session-cookie helper (HttpOnly, SameSite=Lax, Secure in prod, 12h absolute).
- API routes `register` / `login` / `logout`: real Prisma-backed code with zod
  input validation, duplicate-email and no-enumeration handling, audit + security-event writes.
- Browser orchestration layer `src/lib/browser/orchestrator.ts`: full interface
  (launch/stop/status/reconnect, 2 vCPU / 2 GB limits, 30-min idle timeout, stream
  tokens ≤5 min, single-use, hashed) + Docker-service client outline + local stub.
- `browser-image/Dockerfile` (Chromium + KasmVNC image definition), app `Dockerfile`,
  `docker-compose.yml` (app, orchestrator placeholder, postgres, redis, Caddy proxy),
  `.env.example` with placeholder values only, this README.
- **Free-stack deployment config (GitHub + Vercel + Supabase):** `vercel.json`
  (Next.js framework + Prisma-generate build command), `.github/workflows/deploy.yml`
  (install → prisma validate → typecheck → build on every push, all steps must
  pass; Vercel deploy job guarded by an explicit secrets check that fails loudly),
  `docs/FREE_STACK.md` (step-by-step free setup + what this stack cannot run),
  `.env.example` now documents the Supabase values (pooled `DATABASE_URL`,
  direct `DIRECT_URL`, public anon key, server-only service-role key), and
  `prisma/schema.prisma` datasource now uses `directUrl` per Prisma + Supabase
  practice (relationMode deliberately left at the default — Supabase Postgres
  enforces real foreign keys). `ORCHESTRATOR_URL` naming verified consistent
  between `.env.example` and `src/lib/browser/orchestrator.ts` (unchanged).

### Implemented but UNTESTED
- Auth API routes and session flow — code is real but has **not** run against a live
  PostgreSQL yet (no DB in this VM); end-to-end register → verify → login is unverified.
- Prisma schema — validated by `prisma validate`/`generate` only if those commands are
  recorded as run in the delivery report; no migration has been applied to a real DB.
- DockerOrchestrator client — no orchestrator service exists to call yet.
- Free-stack deployment — **configured but NOT executed:** no GitHub repo,
  Supabase project, or Vercel project has been created, nothing has been
  pushed or deployed, and no Prisma migration has run against Supabase yet.
  `vercel.json` was JSON-parsed and `deploy.yml` YAML-parsed locally only;
  the workflow has never run in GitHub Actions, so its install / validate /
  typecheck / build steps are unverified in CI (this repo also has no
  committed `package-lock.json` yet, so the workflow uses `npm install`).

### NOT yet done (Phase 1 remaining)
- **Real streamed Chromium:** browser image NOT built, KasmVNC streaming NOT tested.
  Phase 1 acceptance gate (original §12 criteria 1–5) has **not** passed.
- Email sending (verification + password reset emails) — tokens are created, no mailer.
- Forgot/reset password endpoints, email-verification endpoint (schema + helpers ready).
- TOTP 2FA enrollment + recovery codes; login rate limiting (5/min/IP) + lockout
  backoff enforcement; breached-password check.
- Profile CRUD API + dashboard wiring (dashboard is a shell with empty states).
- Orchestrator service itself (the only component allowed the Docker socket).
- Container egress filtering (block RFC1918 / metadata), idle-timeout enforcement,
  crash auto-restart — specified in code comments/compose, not implemented.
- Argon2id password hashing (bcrypt@12 today, interface ready).
- Phases 2 (sharing UI/API + immediate revocation), 3 (hardening, backup/restore test),
  4 (production deployment — free-stack go-live or VPS) — not started. The free-stack
  configuration files above are preparation for Phase 4, not a completed deployment.
