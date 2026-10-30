// GitHub Codespaces power control for the demo browser host.
//
// The personal access token lives ONLY in the Vercel env var
// GITHUB_WAKE_TOKEN (scope: codespace) and is used server-side to start or
// stop ONE codespace (GITHUB_CODESPACE_NAME). The token is never sent to
// the browser; the panel only sees the resulting power state.

const API = "https://api.github.com";

export function hostPowerConfigured(): boolean {
  const token = process.env.GITHUB_WAKE_TOKEN || "";
  // A PASTE-… placeholder means setup was prepared but the owner has not
  // pasted the real token yet — report "not configured", never call GitHub
  // with a placeholder.
  return !!(token && !token.startsWith("PASTE-") && process.env.GITHUB_CODESPACE_NAME);
}

function ghHeaders() {
  return {
    authorization: `Bearer ${process.env.GITHUB_WAKE_TOKEN || ""}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "secure-cloud-browser",
  };
}

function codespaceUrl(action?: "start" | "stop"): string {
  const name = encodeURIComponent(process.env.GITHUB_CODESPACE_NAME || "");
  return action ? `${API}/user/codespaces/${name}/${action}` : `${API}/user/codespaces/${name}`;
}

// Current power state from GitHub, e.g. "Available" (awake), "Shutdown"
// (asleep), "Queued"/"Provisioning" (starting). Null = GitHub did not
// answer or the state is unknown — the UI must treat null as "unknown",
// never as a guessed state.
export async function getCodespaceState(): Promise<string | null> {
  if (!hostPowerConfigured()) return null;
  try {
    const res = await fetch(codespaceUrl(), {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return typeof data?.state === "string" ? data.state : null;
  } catch {
    return null;
  }
}

async function codespaceAction(action: "start" | "stop"): Promise<{ ok: boolean; state: string | null }> {
  if (!hostPowerConfigured()) return { ok: false, state: null };
  try {
    const res = await fetch(codespaceUrl(action), {
      method: "POST",
      headers: ghHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, state: typeof data?.state === "string" ? data.state : null };
  } catch {
    return { ok: false, state: null };
  }
}

export function startCodespace() {
  return codespaceAction("start");
}

export function stopCodespace() {
  return codespaceAction("stop");
}
