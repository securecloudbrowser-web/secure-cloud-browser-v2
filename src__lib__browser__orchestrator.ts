import { randomUUID } from "crypto";
import { hashToken, generateRawToken } from "@/lib/auth/tokens";

// Browser orchestration layer — v2 Part A section 6 / Part B sections 5, 12.
//
// ARCHITECTURE RULE: the web app NEVER talks to the Docker socket directly.
// It calls a restricted INTERNAL orchestrator service (ORCHESTRATOR_URL) which
// is the only component allowed to manage containers.
//
// STATUS (honest, Phase 1): Docker is NOT available in the current dev VM, so
// no Chromium+KasmVNC container has been launched or streamed yet.
// - `DockerOrchestrator` below is a real client outline against the internal
//   service API, but it is UNTESTED (no service exists yet).
// - `LocalStubOrchestrator` is the default when ORCHESTRATOR_URL is unset. It
//   refuses to launch and says so plainly — it does NOT fake a browser.

export const BROWSER_LIMITS = {
  cpu: Number(process.env.BROWSER_CPU_LIMIT || 2), // 2 vCPU per container
  memoryMb: Number(process.env.BROWSER_MEMORY_LIMIT_MB || 2048), // 2 GB RAM
  profileDiskMb: Number(process.env.BROWSER_PROFILE_DISK_LIMIT_MB || 2048),
  idleTimeoutMinutes: Number(process.env.BROWSER_IDLE_TIMEOUT_MINUTES || 30),
  absoluteSessionHours: Number(process.env.BROWSER_ABSOLUTE_SESSION_HOURS || 12),
  maxProfilesPerUser: Number(process.env.MAX_PROFILES_PER_USER || 5),
  maxSharesPerProfile: Number(process.env.MAX_SHARES_PER_PROFILE || 5),
  streamTokenTtlSeconds: Number(process.env.STREAM_TOKEN_TTL_SECONDS || 300) // <= 5 min
} as const;

export type BrowserStatus = "starting" | "running" | "stopped" | "error";

export interface LaunchRequest {
  profileId: string;
  storageKey: string; // opaque per-profile volume key (dir mode 0700)
  timezone: string;
  locale: string;
  viewportWidth: number;
  viewportHeight: number;
  viewOnly: boolean; // view-only shares: no input, no clipboard, no downloads
  browser?: string; // per-profile engine: "chromium" | "firefox" (orchestrator picks the image)
  // Session lock (v19 orchestrator): force explicitly replaces a live
  // stream-connected session; mode "attach" explicitly joins it. Older
  // orchestrators ignore both fields.
  force?: boolean;
  mode?: "attach";
}

// Per-profile session truth as reported by the v19 orchestrator
// (additive: older orchestrators simply don't send it -> null).
export interface ProfileSessionInfo {
  active: boolean;
  startedAt: string | null; // ISO time the live session started
  streamConnected: boolean; // a stream screen is connected right now
}

// Typed 409 from the orchestrator's session lock: a launch was refused
// because the profile's session is live AND its screen is connected.
// Callers must be able to tell this apart from a generic launch failure.
export class SessionInUseError extends Error {
  readonly startedAt: string | null;
  readonly streamConnected: boolean;
  constructor(startedAt: string | null, streamConnected: boolean) {
    super("session_in_use");
    this.name = "SessionInUseError";
    this.startedAt = startedAt;
    this.streamConnected = streamConnected;
  }
}

export function isSessionInUse(e: unknown): e is SessionInUseError {
  return e instanceof SessionInUseError;
}

// Any non-OK answer from the orchestrator, carrying its HTTP status so
// callers can tell "the host is too old for this endpoint" (404 — the
// endpoint did not exist before v20) apart from real failures.
export class OrchestratorHttpError extends Error {
  readonly status: number;
  // The host's own machine-readable error name (e.g. "source_empty",
  // "not found") when it sent one — lets routes tell a meaningful host
  // refusal apart from "this host is too old for the endpoint" (404).
  readonly hostError: string | null;
  constructor(status: number, path: string, hostError?: string | null) {
    super(`Orchestrator service error ${status} on ${path}`);
    this.name = "OrchestratorHttpError";
    this.status = status;
    this.hostError = hostError ?? null;
  }
}

// Sign-in estimate (v20 orchestrator): presence booleans ONLY — the
// orchestrator never returns cookie values, and this is an estimate by
// design (a server can kill a session whose cookies still sit on disk).
export interface LoginCheckSite {
  site: string;
  label: string;
  likelySignedIn: boolean;
}
export interface LoginCheckResult {
  storeFound: boolean;
  sites: LoginCheckSite[];
  checkedAt: string;
}

export interface BrowserHandle {
  sessionId: string;
  status: BrowserStatus;
  containerRef: string | null; // internal only — never exposed via public API
}

export interface StreamToken {
  rawToken: string; // shown to the authorized caller ONCE, delivered via HttpOnly cookie — never a public URL
  tokenHash: string; // this hash is what gets stored (BrowserSession.streamTokenHash)
  expiresAt: Date; // <= 5 minutes out, single-use
}

export interface BrowserOrchestrator {
  launch(req: LaunchRequest): Promise<BrowserHandle>;
  stop(sessionId: string): Promise<void>;
  status(sessionId: string): Promise<BrowserStatus>;
  reconnect(profileId: string): Promise<BrowserHandle | null>;
  // reconnect + the additive session-truth object (null session when the
  // orchestrator is older and doesn't report one, or nothing is live).
  reconnectWithSession(profileId: string): Promise<{ handle: BrowserHandle | null; session: ProfileSessionInfo | null }>;
  issueStreamToken(sessionId: string): Promise<StreamToken>;
  // v20 host features (older hosts answer 404 -> OrchestratorHttpError,
  // which the API routes translate into a "host purana hai" notice):
  restartBrowser(profileId: string): Promise<{ ok: boolean; restarted: boolean }>;
  loginCheck(profileId: string, storageKey: string): Promise<LoginCheckResult>;
  uploadInbox(profileId: string, storageKey: string, fileName: string, data: Uint8Array): Promise<{ ok: boolean; name: string; size: number }>;
  /** Container egress must block RFC1918 / link-local / 169.254.169.254 (SSRF). Enforced by the orchestrator service + network policy, Phase 3 hardening. */
  readonly name: string;
}

function makeStreamToken(): StreamToken {
  const rawToken = generateRawToken();
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + BROWSER_LIMITS.streamTokenTtlSeconds * 1000)
  };
}

// ---------------------------------------------------------------------------
// Docker-based implementation (client outline — UNTESTED, no service runs yet)
// ---------------------------------------------------------------------------
export class DockerOrchestrator implements BrowserOrchestrator {
  readonly name = "docker";
  constructor(
    private baseUrl: string,
    private internalToken: string
  ) {}

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.internalToken}` // internal service only, never a browser-facing credential
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      // The session lock answers 409 with a JSON contract — surface it as
      // a typed error, never as a generic failure.
      const data = (await res.json().catch(() => null)) as
        | { error?: string; startedAt?: string | null; streamConnected?: boolean }
        | null;
      if (res.status === 409 && data && data.error === "session_in_use") {
        throw new SessionInUseError(data.startedAt ?? null, !!data.streamConnected);
      }
      throw new OrchestratorHttpError(res.status, path, data?.error ?? null);
    }
    return (await res.json()) as T;
  }

  // The service side (to be built) must: create ONE container per profile from
  // browser-image/ (Chromium + KasmVNC), apply BROWSER_LIMITS, mount the
  // profile volume at the Chromium user-data dir, join an egress-only network
  // with private/metadata ranges blocked, never publish DevTools ports, and
  // stop the container after BROWSER_LIMITS.idleTimeoutMinutes idle.
  async launch(req: LaunchRequest): Promise<BrowserHandle> {
    return this.call<BrowserHandle>("/containers", { ...req, limits: BROWSER_LIMITS });
  }
  async stop(sessionId: string): Promise<void> {
    await this.call(`/containers/${sessionId}/stop`, {});
  }
  async status(sessionId: string): Promise<BrowserStatus> {
    const r = await this.call<{ status: BrowserStatus }>(`/containers/${sessionId}`);
    return r.status;
  }
  async reconnect(profileId: string): Promise<BrowserHandle | null> {
    const { handle } = await this.reconnectWithSession(profileId);
    return handle;
  }
  async reconnectWithSession(profileId: string): Promise<{ handle: BrowserHandle | null; session: ProfileSessionInfo | null }> {
    const r = await this.call<{ handle: BrowserHandle | null; session?: ProfileSessionInfo | null }>(
      `/profiles/${profileId}/reconnect`,
      {}
    );
    return { handle: r.handle ?? null, session: r.session ?? null };
  }
  async issueStreamToken(sessionId: string): Promise<StreamToken> {
    // Token is generated app-side, stored hashed in the DB, and the raw value is
    // handed to the proxy/orchestrator over the internal channel only.
    const token = makeStreamToken();
    await this.call(`/containers/${sessionId}/stream-token`, { tokenHash: token.tokenHash, expiresAt: token.expiresAt });
    return token;
  }
  async restartBrowser(profileId: string): Promise<{ ok: boolean; restarted: boolean }> {
    return this.call<{ ok: boolean; restarted: boolean }>(`/profiles/${profileId}/restart-browser`, {});
  }
  async loginCheck(profileId: string, storageKey: string): Promise<LoginCheckResult> {
    // The storageKey lets the host find the profile's saved data even
    // when no session is running (a live session's key wins host-side).
    return this.call<LoginCheckResult>(`/profiles/${profileId}/login-check`, { storageKey });
  }
  async uploadInbox(profileId: string, storageKey: string, fileName: string, data: Uint8Array): Promise<{ ok: boolean; name: string; size: number }> {
    // Raw bytes, not JSON: the file name rides in a header (the
    // orchestrator reduces it to a basename before touching disk) and
    // the profile's storageKey alongside it (used only when the profile
    // has no live session — the app verified ownership before calling).
    const path = `/profiles/${profileId}/inbox`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.internalToken}`,
        "x-storage-key": storageKey,
        "x-file-name": encodeURIComponent(fileName)
      },
      body: data as unknown as BodyInit
    });
    if (!res.ok) throw new OrchestratorHttpError(res.status, path);
    return (await res.json()) as { ok: boolean; name: string; size: number };
  }
}

// ---------------------------------------------------------------------------
// Local stub — default without ORCHESTRATOR_URL. Clearly labelled, honest:
// it does NOT simulate a browser, screenshots, or an iframe (v2 forbids that).
// ---------------------------------------------------------------------------
export class LocalStubOrchestrator implements BrowserOrchestrator {
  readonly name = "local-stub";
  private refuse(): never {
    throw new Error(
      "Browser streaming is NOT available yet: no orchestrator service is configured " +
        "(ORCHESTRATOR_URL is unset) and Docker is not available in this environment. " +
        "This is a Phase 1 stub — no container was launched."
    );
  }
  async launch(): Promise<BrowserHandle> { return this.refuse(); }
  async stop(): Promise<void> { return this.refuse(); }
  async status(): Promise<BrowserStatus> { return "stopped"; }
  async reconnect(): Promise<BrowserHandle | null> { return null; }
  async reconnectWithSession(): Promise<{ handle: BrowserHandle | null; session: ProfileSessionInfo | null }> {
    return { handle: null, session: null };
  }
  async issueStreamToken(): Promise<StreamToken> { return this.refuse(); }
  async restartBrowser(): Promise<{ ok: boolean; restarted: boolean }> { return this.refuse(); }
  async loginCheck(): Promise<LoginCheckResult> { return this.refuse(); }
  async uploadInbox(): Promise<{ ok: boolean; name: string; size: number }> { return this.refuse(); }
}

export function getOrchestrator(): BrowserOrchestrator {
  const url = process.env.ORCHESTRATOR_URL;
  if (url) return new DockerOrchestrator(url, process.env.ORCHESTRATOR_INTERNAL_TOKEN || "");
  return new LocalStubOrchestrator();
}

// Orchestrator client for an explicitly resolved base URL — used by callers
// that resolved the base dynamically (fresh host heartbeat first, env var
// fallback; see lib/browser/host-endpoint.ts). The internal token still
// comes from the env, never from the caller.
export function getOrchestratorFor(baseUrl: string): BrowserOrchestrator {
  return new DockerOrchestrator(baseUrl.replace(/\/$/, ""), process.env.ORCHESTRATOR_INTERNAL_TOKEN || "");
}

export function newSessionId(): string { return randomUUID(); }
