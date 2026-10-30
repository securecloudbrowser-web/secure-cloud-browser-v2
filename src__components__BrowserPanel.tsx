"use client";
import { useRef, useState } from "react";

// Live browser panel for the dashboard: real status from /api/browser/status,
// Start/Stop wired to the orchestrator via the app API. Every state shown is
// the truth from the server — "host not connected" is a state, not an error
// disguised as success.
//
// Status is FETCHED ONCE by the parent (DashboardLive) and passed
// in as props: the panel and the dashboard stat cards share that single
// fetch, so they can never contradict each other.
//
// v2: the host is an RDP server. There is NO Codespace backup host and no
// website-side host power control in v2 — host power is managed on the RDP
// server itself, and the dashboard Host section says so with disabled,
// labelled buttons (never hidden).

export type ProfileSessionInfo = {
  active: boolean;
  startedAt: string | null; // ISO time the live session started
  streamConnected: boolean; // a stream screen is connected right now
};

export type ProfileInfo = {
  id: string;
  name: string;
  browser: string; // "chromium" | "firefox"
  description?: string | null; // optional purpose label (additive; may be absent in older responses)
  running: boolean;
  // Additive session truth (v19 host): absent/null with an older host —
  // the card then renders nothing extra, exactly as before.
  session?: ProfileSessionInfo | null;
};

export type Status = {
  configured: boolean;
  hostOnline: boolean;
  dockerReady?: boolean;
  running: boolean;
  profiles?: ProfileInfo[];
  hostLastSeenAt?: string | null; // ISO time of the last host heartbeat (additive)
  hostPrevEnd?: string | null; // "abrupt" | "clean" | null — how the host's previous run ended (additive, v20 agent)
};

// v20 login estimate, per profile card. The host answers presence
// booleans only; the view labels them as an estimate, never a guarantee.
export type LoginUi =
  | { state: "loading" }
  | { state: "done"; storeFound: boolean; sites: { site: string; label: string; likelySignedIn: boolean }[] }
  | { state: "outdated" }
  | { state: "error"; message: string };

function LoginResultView({ ui }: { ui: LoginUi | undefined }) {
  if (!ui || ui.state === "loading") return null;
  if (ui.state === "outdated") {
    return <p className="mt-2 text-sm text-amber-300">Host purana hai — RDP server par naya host setup chalao, phir login check kaam karega.</p>;
  }
  if (ui.state === "error") {
    return <p className="mt-2 text-sm text-rose-300">{ui.message}</p>;
  }
  if (!ui.storeFound) {
    return <p className="mt-2 text-sm text-zinc-400">Is profile mein abhi koi login data nahi mila.</p>;
  }
  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      {ui.sites.map((s) => (
        <p key={s.site} className="text-sm leading-relaxed text-zinc-300">
          Andaza: {s.label} — {s.likelySignedIn ? "login lagta hai" : "login nahi lagta"}
        </p>
      ))}
      <p className="mt-1.5 text-xs text-zinc-500">Ye sirf andaza hai — pakki tasdeeq ke liye site khol kar dekho.</p>
    </div>
  );
}

// Mirrors BROWSER_LIMITS.maxProfilesPerUser on the server. That constant
// lives in a server lib (imports crypto), so it cannot be imported into
// this client component — keep the two in sync.
const PROFILE_LIMIT = 5;

export default function BrowserPanel({
  status,
  refresh,
  query = "",
  browserFilter = "all",
}: {
  status: Status | null;
  refresh: () => void;
  // Optional list filter driven by the Profiles page search bar.
  query?: string;
  browserFilter?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [newBrowser, setNewBrowser] = useState("chromium");
  const [newDescription, setNewDescription] = useState("");
  // Per-profile UI state: which card is in edit mode / delete-confirm mode.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBrowser, setEditBrowser] = useState("chromium");
  const [editDescription, setEditDescription] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Session lock: a launch was refused because this profile's session is
  // live with its screen connected. The card asks what to do instead of
  // barging in (or failing with a bare error).
  const [inUse, setInUse] = useState<{ profileId: string; startedAt: string | null } | null>(null);
  // v20 host features (per profile): restart-browser confirm, the login
  // estimate result, and the Inbox upload's per-card feedback.
  const [restartConfirmId, setRestartConfirmId] = useState<string | null>(null);
  const [loginByProfile, setLoginByProfile] = useState<Record<string, LoginUi>>({});
  const [inboxByProfile, setInboxByProfile] = useState<Record<string, string>>({});

  const load = refresh;

  // Immediate status refresh after an action, plus ONE more a few
  // seconds later: a status snapshot taken in the same instant as a
  // launch/stop can race the host's view of the container, and without
  // the second look the card kept showing the pre-action state until
  // the 15 s poll (seen live: Start succeeded, card still "Stopped").
  const refreshTimer = useRef<number | null>(null);
  function refreshSoon() {
    load();
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      load();
    }, 2500);
  }

  async function startProfile(profileId: string, opts?: { force?: boolean; mode?: "attach" }) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId, ...(opts?.force ? { force: true } : {}), ...(opts?.mode ? { mode: opts.mode } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "session_in_use") {
        // Not an error: the session is in use. Show the choice dialog on
        // this profile's card and wait for the user's decision.
        setInUse({ profileId, startedAt: typeof data.startedAt === "string" ? data.startedAt : null });
      } else if (res.ok && data.streamUrl) {
        if (inUse?.profileId === profileId) setInUse(null);
        window.open(data.streamUrl, "_blank", "noopener");
        setMsg("Browser started — it opened in a new tab. Your logins stay saved in your account storage.");
      } else {
        setMsg(data.error || "Browser could not start.");
      }
    } catch {
      setMsg("Browser could not start — the host did not answer.");
    }
    setBusy(false);
    refreshSoon();
  }

  async function stopProfile(profileId: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? "Browser stopped. Your profile and logins are saved in your account storage." : data.error || "Stop failed.");
    } catch {
      setMsg("Stop failed — the host did not answer.");
    }
    setBusy(false);
    refreshSoon();
  }

  // v20: restart ONLY the browser inside the running container — the
  // escape hatch for an empty desktop / vanished Chrome, without losing
  // the session. Tabs come back via the browser's own session restore.
  async function restartBrowser(profileId: string) {
    setBusy(true);
    setMsg("");
    setRestartConfirmId(null);
    try {
      const res = await fetch("/api/browser/restart-browser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg("Browser dobara khol diya gaya — tabs restore ho jayenge. Stream wali tab par dobara judne ka intezar karo.");
      } else if (data.error === "host_outdated") {
        setMsg(data.message || "Host purana hai — pehle RDP server par naya host setup chalao.");
      } else if (data.error === "no_live_session") {
        setMsg(data.message || "Is profile ka koi session chal nahi raha — pehle browser Start karo.");
      } else {
        setMsg(data.error || "Browser restart nahi ho saka.");
      }
    } catch {
      setMsg("Browser restart nahi ho saka — host ne jawab nahi diya.");
    }
    setBusy(false);
    refreshSoon();
  }

  // v20: sign-in estimate — presence booleans from the host, shown
  // clearly labelled as an estimate, never as a guarantee.
  async function runLoginCheck(profileId: string) {
    setLoginByProfile((m) => ({ ...m, [profileId]: { state: "loading" } }));
    try {
      const res = await fetch("/api/browser/login-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.sites)) {
        setLoginByProfile((m) => ({
          ...m,
          [profileId]: { state: "done", storeFound: !!data.storeFound, sites: data.sites }
        }));
      } else if (data.error === "host_outdated") {
        setLoginByProfile((m) => ({ ...m, [profileId]: { state: "outdated" } }));
      } else {
        setLoginByProfile((m) => ({
          ...m,
          [profileId]: { state: "error", message: data.error || "Login check nahi ho saka." }
        }));
      }
    } catch {
      setLoginByProfile((m) => ({
        ...m,
        [profileId]: { state: "error", message: "Login check nahi ho saka — host ne jawab nahi diya." }
      }));
    }
  }

  // v20: send a file into the profile's Inbox folder on the RDP host (the
  // browser's file picker reaches it from the browser user's home).
  async function uploadInbox(profileId: string, file: File) {
    setInboxByProfile((m) => ({ ...m, [profileId]: "File bheji ja rahi hai…" }));
    try {
      const form = new FormData();
      form.set("profileId", profileId);
      form.set("file", file);
      const res = await fetch("/api/browser/inbox", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInboxByProfile((m) => ({
          ...m,
          [profileId]: `File bhej di gayi: ${typeof data.name === "string" ? data.name : file.name} — browser ke file picker mein Inbox folder mein milegi.`
        }));
      } else if (data.error === "host_outdated") {
        setInboxByProfile((m) => ({ ...m, [profileId]: data.message || "Host purana hai — pehle RDP server par naya host setup chalao." }));
      } else if (data.error === "file_too_large") {
        setInboxByProfile((m) => ({ ...m, [profileId]: "File bohat bari hai — zyada se zyada 25 MB." }));
      } else {
        setInboxByProfile((m) => ({ ...m, [profileId]: data.error || "File nahi bheji ja saki." }));
      }
    } catch {
      setInboxByProfile((m) => ({ ...m, [profileId]: "File nahi bheji ja saki — host ne jawab nahi diya." }));
    }
  }

  async function addProfile() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName, browser: newBrowser, description: newDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewName("");
        setNewBrowser("chromium");
        setNewDescription("");
        setMsg("Profile created — start it from its card above whenever your host is online.");
      } else {
        setMsg(data.error || "Profile could not be created.");
      }
    } catch {
      setMsg("Profile could not be created — the site did not answer.");
    }
    setBusy(false);
    refreshSoon();
  }

  function beginEdit(p: ProfileInfo) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditBrowser(p.browser);
    setEditDescription(p.description ?? "");
    setDeletingId(null);
    setMsg("");
  }

  async function saveEdit(profileId: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/profiles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: profileId, name: editName, browser: editBrowser, description: editDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEditingId(null);
        setMsg("Profile updated.");
      } else {
        setMsg(data.error || "Profile could not be updated.");
      }
    } catch {
      setMsg("Profile could not be updated — the site did not answer.");
    }
    setBusy(false);
    refreshSoon();
  }

  function beginDelete(profileId: string) {
    setDeletingId(profileId);
    setEditingId(null);
    setMsg("");
  }

  async function deleteProfile(profileId: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/profiles", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: profileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDeletingId(null);
        setMsg("Profile deleted.");
      } else {
        setMsg(data.error || "Profile could not be deleted.");
      }
    } catch {
      setMsg("Profile could not be deleted — the site did not answer.");
    }
    setBusy(false);
    refreshSoon();
  }

  const running = !!status?.running;
  const hostReady = !!status?.configured && !!status?.hostOnline && !!status?.dockerReady;
  const allProfiles = status?.profiles ?? [];
  const profiles = allProfiles.filter(
    (p) =>
      (browserFilter === "all" || p.browser === browserFilter) &&
      (query.trim() === "" || p.name.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const atProfileLimit = allProfiles.length >= PROFILE_LIMIT;

  // One pill wording everywhere: the pill reports the RDP HOST state only
  // ("RDP online — ready" / "RDP offline"); whether a browser is running is
  // shown by the per-profile badges and the explanation line, not the pill.
  const pill = !status
    ? { text: "checking…", cls: "border-white/10 bg-white/5 text-zinc-400", dot: "bg-zinc-400" }
    : hostReady
      ? { text: "RDP online — ready", cls: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400 animate-pulse" }
      : { text: "RDP offline", cls: "border-rose-400/20 bg-rose-400/10 text-rose-300", dot: "bg-rose-400" };

  // Last-seen: only when the host is offline and the server sent the field
  // (older responses without it simply show nothing extra).
  const lastSeenText =
    status && !status.hostOnline && typeof status.hostLastSeenAt === "string" && status.hostLastSeenAt
      ? new Date(status.hostLastSeenAt).toLocaleString()
      : null;

  // Previous-run classification (v20 agent): one subtle line, shown only
  // while the host is ONLINE and the server actually sent a known value —
  // an older agent or app response leaves the field absent/null and
  // nothing renders.
  const prevEndText =
    status && status.hostOnline && status.hostPrevEnd === "abrupt"
      ? "Pichli dafa host achanak band hua tha (bijli / crash)"
      : status && status.hostOnline && status.hostPrevEnd === "clean"
        ? "Pichli dafa host saf tareeqay se band hua tha"
        : null;

  const explanation = !status
    ? "Checking your RDP browser host…"
    : !status.configured
      ? "The RDP browser host is not connected to the website yet. Once the host agent on the RDP server is running, this panel comes alive. Nothing is running right now."
      : !status.hostOnline
        ? "Your RDP host is OFFLINE right now. If the RDP server is on and its host agent is started, this panel turns online within a minute or two — it updates itself, just wait. A website cannot switch on a powered-off RDP server."
        : !status.dockerReady
          ? "The RDP host answered, but its browser engine is not ready yet. Give it a few seconds, then press Start browser."
          : running
            ? "Your cloud browser is running on the RDP host. Its profile — cookies and logins — is saved on the RDP host and survives stops and restarts."
            : "Your RDP host is ONLINE and live. Press Start browser to launch your persistent cloud browser.";

  return (
    <div className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-lg shadow-indigo-500/25">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18" />
              <path d="M6.5 6.5h.01M9.5 6.5h.01" />
            </svg>
          </span>
          <h2 className="font-semibold text-white">Your cloud browser</h2>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${pill.cls}`}>
          <span className={`h-2 w-2 rounded-full ${pill.dot}`} />
          {pill.text}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-zinc-400">{explanation}</p>
      {lastSeenText && (
        <p className="mt-2 text-sm text-zinc-500">Host aakhri dafa online tha: {lastSeenText}</p>
      )}
      {prevEndText && (
        <p className="mt-2 text-sm text-zinc-500">{prevEndText}</p>
      )}
      {msg && <p className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">{msg}</p>}

      <div className="mt-4 space-y-3">
        {profiles.map((p) => (
          <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/20">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-semibold text-zinc-100">{p.name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${p.browser === "firefox" ? "border-orange-400/30 bg-orange-400/10 text-orange-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300"}`}>
                {p.browser === "firefox" ? "Firefox" : "Google Chrome"}
              </span>
              <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${p.running ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/5 text-zinc-400"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${p.running ? "bg-emerald-400" : "bg-zinc-500"}`} />
                {p.running ? "Running" : "Stopped"}
              </span>
            </div>
            {typeof p.description === "string" && p.description.trim() !== "" && (
              <p className="mt-1.5 text-sm text-zinc-400">{p.description}</p>
            )}
            {p.running && p.session && (
              <p className="mt-1.5 text-sm text-zinc-500">
                Session chal raha hai — since {p.session.startedAt ? new Date(p.session.startedAt).toLocaleString() : "—"} · Screen: {p.session.streamConnected ? "judi hui hai" : "nahi judi"}
              </p>
            )}

            {deletingId === p.id ? (
              <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3">
                <p className="text-sm leading-relaxed text-rose-200">Delete this profile? Its saved logins and data will be removed from the site.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => deleteProfile(p.id)} disabled={busy} className="rounded-full bg-rose-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-rose-500/25 transition hover:opacity-90 disabled:opacity-50">
                    {busy ? "Working…" : "Yes, delete"}
                  </button>
                  <button onClick={() => setDeletingId(null)} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : editingId === p.id ? (
              <div className="mt-3">
                <div className="flex flex-wrap gap-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Profile name (e.g. Work)"
                    maxLength={40}
                    className="min-w-48 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                  />
                  <select
                    value={editBrowser}
                    onChange={(e) => setEditBrowser(e.target.value)}
                    className="rounded-full border border-white/15 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-400/50"
                  >
                    <option value="chromium">Google Chrome</option>
                    <option value="firefox">Firefox</option>
                  </select>
                </div>
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Ye profile kis kaam ke liye hai (optional)"
                  maxLength={200}
                  className="mt-3 w-full rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => saveEdit(p.id)} disabled={busy || !editName.trim()} className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy ? "Working…" : "Save"}
                  </button>
                  <button onClick={() => setEditingId(null)} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.running ? (
                  <>
                    <button onClick={() => startProfile(p.id)} disabled={busy} className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-90 disabled:opacity-50">
                      {busy ? "Working…" : "Open browser"}
                    </button>
                    <button onClick={() => stopProfile(p.id)} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
                      Stop browser
                    </button>
                  </>
                ) : (
                  <button onClick={() => startProfile(p.id)} disabled={busy || !hostReady} className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40" title={hostReady ? "Start your cloud browser" : "Available when your browser host is online"}>
                    {busy ? "Starting…" : "▶ Start browser"}
                  </button>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  <button onClick={() => beginEdit(p)} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
                    Edit
                  </button>
                  <button onClick={() => beginDelete(p.id)} disabled={busy} className="rounded-full border border-rose-400/30 bg-rose-400/5 px-4 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-50">
                    Delete
                  </button>
                </div>
              </div>
            )}

            {/* v20 host features row: restart the browser in place, send a
                file into the profile's Inbox, or run the login estimate.
                On a pre-v20 host these answer with a "host purana hai"
                notice instead of breaking anything. */}
            {deletingId !== p.id && editingId !== p.id && (
              <>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {p.running && restartConfirmId !== p.id && (
                    <button onClick={() => setRestartConfirmId(p.id)} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
                      {p.browser === "firefox" ? "Browser dobara kholo" : "Chrome dobara kholo"}
                    </button>
                  )}
                  <label className="cursor-pointer rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10">
                    File bhejo (Inbox)
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0];
                        e.target.value = "";
                        if (f) uploadInbox(p.id, f);
                      }}
                    />
                  </label>
                  <button
                    onClick={() => runLoginCheck(p.id)}
                    disabled={loginByProfile[p.id]?.state === "loading"}
                    className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {loginByProfile[p.id]?.state === "loading" ? "Check ho raha hai…" : "Login check"}
                  </button>
                </div>
                {restartConfirmId === p.id && (
                  <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
                    <p className="text-sm leading-relaxed text-amber-100">
                      Chal raha {p.browser === "firefox" ? "browser" : "Chrome"} band karke usi profile mein dobara khulega — tabs restore ho jayenge.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => restartBrowser(p.id)} disabled={busy} className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-90 disabled:opacity-50">
                        {busy ? "Working…" : "Haan, dobara kholo"}
                      </button>
                      <button onClick={() => setRestartConfirmId(null)} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {inboxByProfile[p.id] && <p className="mt-2 text-sm text-zinc-400">{inboxByProfile[p.id]}</p>}
                <LoginResultView ui={loginByProfile[p.id]} />
              </>
            )}

            {inUse?.profileId === p.id && (
              <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3">
                <p className="text-sm leading-relaxed text-amber-100">
                  Is profile ka session pehle se chal raha hai aur screen judi hui hai (since {inUse.startedAt ? new Date(inUse.startedAt).toLocaleString() : "—"}). Doosra Start use band kar dega.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => startProfile(p.id, { mode: "attach" })} disabled={busy} className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-90 disabled:opacity-50">
                    {busy ? "Working…" : "Wahi session kholo"}
                  </button>
                  <button onClick={() => startProfile(p.id, { force: true })} disabled={busy} className="rounded-full bg-rose-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-rose-500/25 transition hover:opacity-90 disabled:opacity-50">
                    {busy ? "Working…" : "Naya session zabardasti — purana band hoga"}
                  </button>
                  <button onClick={() => setInUse(null)} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {status && allProfiles.length === 0 && (
        <p className="mt-4 text-sm text-zinc-400">No profiles yet — create your first profile below, then start it from here.</p>
      )}

      <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-4">
        <h3 className="text-sm font-semibold text-white">＋ New profile</h3>
        {atProfileLimit ? (
          <p className="mt-2 text-sm text-zinc-400">Profile limit reached ({PROFILE_LIMIT}).</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Profile name (e.g. Work)"
                maxLength={40}
                className="min-w-48 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
              />
              <select
                value={newBrowser}
                onChange={(e) => setNewBrowser(e.target.value)}
                className="rounded-full border border-white/15 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-400/50"
              >
                <option value="chromium">Google Chrome</option>
                <option value="firefox">Firefox</option>
              </select>
              <button onClick={addProfile} disabled={busy || !newName.trim()} className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? "Working…" : "Add profile"}
              </button>
            </div>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Ye profile kis kaam ke liye hai (optional)"
              maxLength={200}
              className="mt-3 w-full rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400/50"
            />
          </>
        )}
      </div>

    </div>
  );
}
