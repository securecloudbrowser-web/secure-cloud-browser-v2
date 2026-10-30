"use client";
import { useCallback, useEffect, useState } from "react";
import BrowserPanel, { type Status } from "@/components/BrowserPanel";

// Dashboard live section (Stitch layout): owns the SINGLE status fetch for
// the dashboard home. The RDP host banner, the metric cards, the Quick
// Reconnect card and the browser panel are all rendered from this one
// `status` object, so they can never contradict each other.
//
// Shared Links and Stream Time are real counts computed server-side by the
// dashboard page (DB) and passed in as props — the status API does not
// carry them.

export default function DashboardLive({
  sharedLinks = 0,
  streamHours = 0
}: {
  sharedLinks?: number;
  streamHours?: number;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/browser/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // leave status as-is; the dashboard keeps its last honest state
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const profiles = status?.profiles ?? [];
  const runningProfiles = profiles.filter((p) => p.running);
  const hostReady = !!status?.configured && !!status?.hostOnline && !!status?.dockerReady;
  const continueProfile = runningProfiles[0] ?? profiles[0] ?? null;

  async function quickReconnect() {
    if (!continueProfile) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: continueProfile.id, ...(continueProfile.running ? { mode: "attach" } : {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.streamUrl) {
        window.open(data.streamUrl, "_blank", "noopener");
        setMsg("Live session opened in a new tab.");
      } else if (res.status === 409 && data.error === "session_in_use") {
        setMsg("That profile's session is live with its screen connected — open it from its profile card to choose what to do.");
      } else {
        setMsg(data.error || "Could not open the live session.");
      }
    } catch {
      setMsg("Could not open the live session — the RDP host did not answer.");
    }
    setBusy(false);
    load();
  }

  const cards = [
    { title: "Browser Profiles", value: status ? `${profiles.length} / 5` : "—", note: profiles.length ? profiles.map((p) => p.name).join(", ") : "No profiles yet", chip: "from-indigo-500 to-violet-500 shadow-indigo-500/30" },
    { title: "Active Sessions", value: status ? String(runningProfiles.length) : "—", note: runningProfiles.length ? runningProfiles.map((p) => p.name).join(", ") : "No browser is running", chip: "from-emerald-500 to-teal-400 shadow-emerald-500/30" },
    { title: "Shared Links", value: String(sharedLinks), note: sharedLinks ? "Active profile share links" : "No active share links", chip: "from-cyan-500 to-sky-400 shadow-cyan-500/30" },
    { title: "Stream Time", value: `${streamHours.toFixed(1)} hrs`, note: "Total across your finished sessions", chip: "from-violet-500 to-fuchsia-500 shadow-violet-500/30" }
  ];

  return (
    <div className="space-y-4">
      {/* RDP host banner (Stitch) */}
      <div className="glass relative overflow-hidden rounded-3xl p-6">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="min-w-56 flex-1">
            <p className="mono-label">Host · RDP Server</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-2.5 text-lg font-semibold text-white">
              <span className={`h-2.5 w-2.5 rounded-full ${hostReady ? "animate-pulse bg-emerald-400" : "bg-rose-400"}`} />
              {!status ? "Checking RDP host…" : hostReady ? "RDP Online • Ready" : "RDP Offline"}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {!status
                ? "Asking the host agent for its current state."
                : hostReady
                  ? "The browser host on the RDP server is live and ready to launch profiles."
                  : status.hostLastSeenAt
                    ? `Host last seen ${new Date(status.hostLastSeenAt).toLocaleString()}. It reconnects by itself when the RDP agent is running.`
                    : "The host agent on the RDP server has not checked in yet."}
            </p>
          </div>
          {/* Host power: no website-side power API exists for the RDP host,
              so both controls are ALWAYS present, disabled, and labelled —
              never hidden, never fake. */}
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex flex-wrap gap-2">
              <button disabled className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60" title="Host power is managed on the RDP server itself">
                Restart Host
              </button>
              <button disabled className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60" title="Host power is managed on the RDP server itself">
                Sleep Host
              </button>
            </div>
            <p className="max-w-64 text-xs leading-relaxed text-zinc-500">
              Host power is managed on the RDP server itself — these controls are not wired to the RDP host{hostReady ? "." : " (and the host is offline)."}
            </p>
          </div>
        </div>
      </div>

      {/* Metric cards (Stitch) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.title} className="glass group rounded-3xl p-5 transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.07]">
            <div className="flex items-center justify-between gap-2">
              <p className="mono-label">{c.title}</p>
              <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br shadow-lg ${c.chip}`} />
            </div>
            <p className="mt-3 bg-gradient-to-b from-white to-zinc-400 bg-clip-text font-mono text-3xl font-bold tracking-tight text-transparent">{c.value}</p>
            <p className="mt-1.5 truncate text-xs text-zinc-500" title={c.note}>{c.note}</p>
          </div>
        ))}
      </div>

      {/* Quick Reconnect / Continue Work (Stitch) */}
      <div className="glass flex flex-wrap items-center gap-4 rounded-3xl p-6">
        <div className="min-w-56 flex-1">
          <p className="mono-label">Quick Reconnect</p>
          <p className="mt-1.5 font-semibold text-white">
            {continueProfile ? `Continue Work — ${continueProfile.name}` : "No profile yet"}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {continueProfile
              ? continueProfile.running
                ? "This profile's browser is running on the RDP host — jump straight back into its live session, tabs and logins intact."
                : "Start this profile and pick up exactly where you left off — logins and tabs are saved on the RDP host."
              : "Create your first profile below, then start it whenever the host is online."}
          </p>
          {msg && <p className="mt-2 text-sm text-zinc-300">{msg}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={quickReconnect} disabled={busy || !continueProfile || !hostReady} className="btn-primary" title={hostReady ? "Open the live session" : "Available when the RDP host is online"}>
            {busy ? "Working…" : continueProfile?.running ? "Jump to Live Session" : "Start & Open"}
          </button>
          <a href="/dashboard/profiles#new-profile" className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10">
            New Profile
          </a>
          <a href="/dashboard/shares" className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10">
            Generate Share Link
          </a>
        </div>
      </div>

      {/* Live browser panel — Active & Saved Profiles (real status + actions) */}
      <BrowserPanel status={status} refresh={load} />
    </div>
  );
}
