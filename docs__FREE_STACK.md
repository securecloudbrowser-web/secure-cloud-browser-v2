# Free Stack Setup — GitHub + Vercel + Supabase (all free tiers)

This is the **primary deployment path**: the web app, its code/CI, and its
database run entirely on free tiers. One part of the platform does **not**
run on this stack — the persistent Chromium browsers. Read
[WHAT THIS STACK DOES NOT RUN](#what-this-stack-does-not-run) before you start,
so the limit is clear up front.

| Piece | Service | What it runs |
|---|---|---|
| Code + CI | GitHub (free) | Repository, GitHub Actions checks (`.github/workflows/deploy.yml`) |
| App hosting | Vercel (free Hobby) | Next.js app: pages, dashboard, API routes |
| Database | Supabase (free) | PostgreSQL database (all Prisma models), API keys |

> Free-tier limits change. The notes below describe what each free tier is
> *for*, generically — **re-check each provider's pricing/limits page when you
> set this up**, because quotas (build minutes, bandwidth, database size,
> project pausing rules) change over time and are not guaranteed here.

---

## Step 1 — GitHub repository

1. Create a free GitHub account if you don't have one: https://github.com
2. Create a new repository (e.g. `secure-cloud-browser`). Keep it **private**
   while it contains your deployment configuration.
3. Push this project (the contents of this `app/` folder is the repo root):

   ```bash
   cd app
   git init
   git add .
   git commit -m "Phase 1 scaffold — free stack (GitHub + Vercel + Supabase)"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/secure-cloud-browser.git
   git push -u origin main
   ```

4. Never commit a real `.env` file or real keys. `.gitignore` already excludes
   `.env`; only `.env.example` (placeholders) belongs in the repo.

## Step 2 — Supabase project (free)

1. Sign up free at https://supabase.com and create a new project. Choose a
   strong database password and **save it somewhere safe** — you need it in the
   connection strings below, and it is not shown again.
2. Supabase **is** PostgreSQL, so the existing Prisma schema works unchanged.
   The only adjustment (already made in `prisma/schema.prisma`) is the
   documented Prisma + Supabase practice: `DATABASE_URL` uses the **pooled**
   (PgBouncer) connection for runtime, and `DIRECT_URL` uses the **direct**
   connection for migrations.
3. Collect these values from the Supabase dashboard:
   - **Project URL + anon key + service-role key:** Settings → API.
   - **Connection strings:** Settings → Database (or the "Connect" button).
     You need two forms:
     - *Pooled / transaction* (port **6543**, host like
       `aws-0-<region>.pooler.supabase.com`) → `DATABASE_URL`, and it must end
       with `?pgbouncer=true`.
     - *Direct* (port **5432**) → `DIRECT_URL`.
   - Replace `YOUR_PROJECT_REF`, `YOUR_REGION`, and `YOUR_DB_PASSWORD` in the
     examples in `.env.example` with your project's real values — in the
     **Vercel environment variables** (Step 3), not in any committed file.

   ⚠️ **The service-role key is server-only.** It bypasses Row Level Security.
   Never use it in browser/client code, never prefix it with `NEXT_PUBLIC_`,
   never paste it into GitHub or any public place. The `NEXT_PUBLIC_` values
   (project URL + anon key) are the public ones.

## Step 3 — Vercel project (free)

1. Sign up free at https://vercel.com (you can log in with your GitHub account).
2. **Add New → Project**, and import the GitHub repository from Step 1.
   Vercel detects Next.js automatically; `vercel.json` in the repo root pins
   the framework and the build command (`npx prisma generate && next build`).
3. Before the first deploy, open **Project → Settings → Environment Variables**
   and add (Production environment; values from Step 2 and `.env.example`):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase **pooled** string (port 6543, `?pgbouncer=true`) |
   | `DIRECT_URL` | Supabase **direct** string (port 5432) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
   | `APP_URL` | Your Vercel production URL, e.g. `https://your-project.vercel.app` |
   | `SESSION_COOKIE_NAME` | `scb_session` |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Your email provider (required for verification / password-reset email) |
   | `ORCHESTRATOR_URL` | Public HTTPS URL of your browser host — see below. Leave unset until you have one; the app then honestly reports that browser streaming is not available yet. |
   | `ORCHESTRATOR_INTERNAL_TOKEN` | A long random secret you also set on the browser host |

4. Deploy. Pushes to `main` can deploy two ways — use one:
   - **Vercel's Git integration** (default on import): every push deploys.
   - **GitHub Actions** (`.github/workflows/deploy.yml`): runs install,
     `prisma validate`, typecheck, and build first; the Vercel deploy job then
     runs **only if** these repository secrets exist (Settings → Secrets and
     variables → Actions): `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
     `VERCEL_PROJECT_ID`. If they are missing, the job **fails loudly** — it
     never fakes a successful deploy. If you use the Actions path, disconnect
     Vercel's own Git auto-deploy to avoid double deploys.

## Step 4 — Run the Prisma migration against Supabase

The database starts empty. Create the tables once, from your own computer
(not from Vercel), using the **direct** connection:

```bash
cd app
cp .env.example .env     # fill .env with your REAL Supabase values, locally only
npm install
npx prisma migrate dev --name init    # first time: creates + applies the migration
# On later schema changes, the same command creates a new migration.
# For an already-migrated database: npx prisma migrate deploy
```

Verify in the Supabase dashboard (Table Editor) that the tables exist:
`User`, `UserSession`, `BrowserProfile`, `BrowserSession`, `ProfileShare`,
`Invitation`, `AccessPermission`, `AuditLog`, `PasswordResetToken`,
`EmailVerificationToken`, `SecurityEvents`.

> Status note (honest): as of the Phase 1 status in `README.md`, this
> migration has **not yet been run against a real Supabase project** — no
> account has been created and no deployment attempted yet. Treat the first
> run as a test and report any error rather than assuming success.

## What each free tier covers (and its general limits)

- **GitHub (free):** public/private repositories and a monthly allowance of
  Actions minutes for CI. Enough for this project's checks; heavy CI usage can
  exhaust the allowance until it resets.
- **Vercel (free Hobby):** hosting for the Next.js app with automatic HTTPS and
  preview deployments. It is for non-commercial / personal use under the
  Hobby terms, and it has limits on things like bandwidth, function execution
  time, and build usage. Serverless functions are **stateless and
  time-limited** — fine for pages and API routes, which is all this app asks
  of Vercel.
- **Supabase (free):** a real PostgreSQL database plus API keys. Free projects
  have capped database size and can be **paused after inactivity**, so an
  unused project may need to be un-paused in the dashboard before the app can
  reach it.

Re-check the current numbers on each provider's site when you deploy; do not
rely on any quota written in a tutorial (including this one) staying current.

---

## WHAT THIS STACK DOES NOT RUN

**The persistent Chromium browser containers cannot be hosted on GitHub,
Vercel, or Supabase.** This is a hard technical limit, not a missing setting:

- **GitHub** stores code and runs short CI jobs; it is not an application host
  and does not run long-lived containers.
- **Vercel** runs stateless, time-limited serverless functions. It has no
  Docker daemon, no persistent disk for browser profile volumes (cookies /
  local storage that must survive between visits), and cannot keep a browser
  session streaming for hours.
- **Supabase** is a database (plus auth/storage APIs). It runs no containers
  at all.

So on the free stack, everything works **except** launching the actual cloud
browser: registration, login, dashboard, profiles, sharing records, and audit
logs all live happily on GitHub + Vercel + Supabase. For the browser itself you
need **one machine that runs Docker**, pointed to by the `ORCHESTRATOR_URL`
environment variable (the app's `src/lib/browser/orchestrator.ts` already
reads exactly that variable). Options:

### (a) Oracle Cloud Always Free VM
A free-tier cloud VM that you control like a small VPS. Install Docker and
the orchestrator service (+ the `browser-image/` Chromium + KasmVNC image) on
it, open only the orchestrator's HTTPS endpoint (behind a reverse proxy with
the internal token), and set `ORCHESTRATOR_URL` in Vercel to that endpoint.
Free-tier cloud VMs have modest CPU/RAM and availability varies by region —
good enough to start and to test one browser at a time.

### (b) RDP server running Docker + Tailscale Funnel (v2 primary)
Run Docker on the RDP server, start the orchestrator service there, and
expose it through Tailscale Funnel so the Vercel app can reach it at a
stable `*.ts.net` HTTPS URL; set that URL as `ORCHESTRATOR_URL` (the host
agent also heartbeats its current URL to `/api/host/heartbeat`). Profiles
live on the RDP disk, the agent auto-starts on reboot/login, and a
watchdog restarts the orchestrator — this is the always-on v2 setup.

In both options: the browser host is the **only** place the Docker socket,
profile volumes, and streaming ports live. They are never exposed through
Vercel, GitHub, or Supabase, and stream access still goes through the app's
short-lived (≤ 5 minute), single-use, hashed stream tokens.
