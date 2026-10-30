import { prisma } from "@/lib/prisma";

// Dynamic orchestrator base URL resolution.
//
// The RDP host is reached through a free tunnel whose URL changes on every
// host restart, so a static ORCHESTRATOR_URL goes stale. Instead, the PC
// agent POSTs a heartbeat with its current tunnel URL to
// /api/host/heartbeat, which stores it in the single-row HostEndpoint
// table. Resolution rule everywhere in the app:
//   1. the heartbeated URL, if its last heartbeat is <= 180 seconds old;
//   2. otherwise process.env.ORCHESTRATOR_URL;
//   3. otherwise null (no host configured — callers answer honestly).

const HOST_ENDPOINT_ID = "pc-host";
const HEARTBEAT_MAX_AGE_MS = 180_000; // 180 seconds

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// prevEnd (v20 agent): how the host's previous run ended — "abrupt" or
// "clean", already validated by the heartbeat route. Three cases for the
// stored value:
//   - a validated string  → store it;
//   - null                → the agent sent the field with an unusable
//                           value; store null (unknown);
//   - undefined           → the heartbeat carried NO prevEnd field (older
//                           agent): leave the stored value untouched so a
//                           previously recorded classification survives.
export async function recordHostHeartbeat(url: string, prevEnd?: string | null): Promise<void> {
  const clean = stripTrailingSlash(url);
  await prisma.hostEndpoint.upsert({
    where: { id: HOST_ENDPOINT_ID },
    create: { id: HOST_ENDPOINT_ID, url: clean, ...(prevEnd !== undefined ? { prevEnd } : {}) },
    update: { url: clean, ...(prevEnd !== undefined ? { prevEnd } : {}) }
  });
}

// The stored previous-run classification ("abrupt" | "clean"), or null
// when unknown / never recorded. Read-only, same failure posture as
// getHostLastSeenAt: a missing column (SQL not run yet) or unreachable DB
// yields null instead of failing the request.
export async function getHostPrevEnd(): Promise<string | null> {
  try {
    const row = await prisma.hostEndpoint.findUnique({ where: { id: HOST_ENDPOINT_ID } });
    return row?.prevEnd ?? null;
  } catch {
    return null;
  }
}

export interface ResolvedOrchestratorBase {
  base: string; // orchestrator base URL, never with a trailing slash
  fromHeartbeat: boolean; // true when the base came from a fresh heartbeat
}

export async function resolveOrchestratorBaseDetailed(): Promise<ResolvedOrchestratorBase | null> {
  try {
    const row = await prisma.hostEndpoint.findUnique({ where: { id: HOST_ENDPOINT_ID } });
    if (row && Date.now() - row.updatedAt.getTime() <= HEARTBEAT_MAX_AGE_MS) {
      return { base: stripTrailingSlash(row.url), fromHeartbeat: true };
    }
  } catch {
    // HostEndpoint table missing (schema not pushed yet) or DB unreachable —
    // fall through to the env var instead of failing the request.
  }
  const env = process.env.ORCHESTRATOR_URL;
  if (env) return { base: stripTrailingSlash(env), fromHeartbeat: false };
  return null;
}

export async function resolveOrchestratorBase(): Promise<string | null> {
  const resolved = await resolveOrchestratorBaseDetailed();
  return resolved ? resolved.base : null;
}

// The host's last-seen time = the HostEndpoint row's last update (every
// heartbeat refreshes it). Used by the dashboard to say "Host aakhri dafa
// online tha: …" when the host is offline. Read-only; never changes the
// resolution semantics above. Null when no heartbeat was ever recorded.
export async function getHostLastSeenAt(): Promise<Date | null> {
  try {
    const row = await prisma.hostEndpoint.findUnique({ where: { id: HOST_ENDPOINT_ID } });
    return row ? row.updatedAt : null;
  } catch {
    return null;
  }
}
