"use client";
import { useCallback, useEffect, useState } from "react";
import type { Status } from "@/components/BrowserPanel";

// Host / RDP Server page: real state from /api/browser/status. Host power
// has NO website-side API for an RDP host, so Restart/Sleep are always
// present, disabled, and labelled — never hidden, never fake. The
// auto-start / watchdog / keep-awake rows describe the RDP host agent's
// setup (installed on the server); they are labelled as setup facts, not
// live-verified telemetry.
export default function HostLive() {
  const [status, setStatus] = useState<Status | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/browser/status");
      if (res.ok) setStatus(await res.json());
    } catch { /* keep last honest state */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const online = !!status?.hostOnline;
  const ready = online && !!status?.dockerReady;
  const runningCount = status?.profiles?.filter((p) => p.running).length ?? 0;

  const facts: [string, string][] = [
    ["Host type", "RDP server (v2 host — not a PC, not a Codespace)"],
    ["Connection", status ? (status.configured ? "Configured" : "Not connected yet") : "Checking…"],
    ["Browser engine", status ? (status.dockerReady ? "Ready (Docker)" : online ? "Host answered — engine not ready" : "Unknown — host offline") : "Checking…"],
    ["Running profiles", status ? String(runningCount) : "—"],
    ["Profiles total", status ? `${status.profiles?.length ?? 0} / 5` : "—"],
    ["Last heartbeat", status?.hostLastSeenAt ? new Date(status.hostLastSeenAt).toLocaleString() : "—"],
    ["Previous run ended", status?.hostPrevEnd === "abrupt" ? "Abruptly (power loss / crash)" : status?.hostPrevEnd === "clean" ? "Cleanly (proper shutdown)" : "Unknown"]
  ];

  const setupRows: [string, string][] = [
    ["Auto-start on RDP reboot / login", "Set up in the RDP host agent — the host checks in by itself after the server starts"],
    ["Watchdog auto-restart", "Part of the RDP host agent setup — restarts the orchestrator if it stops answering"],
    ["Keep-awake on the RDP server", "Set up in the RDP host agent — prevents sleep while hosting browsers"],
    ["Profile storage", "Persistent on the RDP server's disk — profiles, logins and tabs survive host restarts"],
    ["Stable access URL", "Via Tailscale Funnel (*.ts.net) from the RDP host agent; the app follows its heartbeat URL"]
  ];

  const disabledBtn = "rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-4">
      <div className="glass relative overflow-hidden rounded-3xl p-6">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="min-w-56 flex-1">
            <p className="mono-label">Host Status</p>
            <p className="mt-1.5 flex items-center gap-2.5 text-xl font-semibold text-white">
              <span className={`h-2.5 w-2.5 rounded-full ${ready ? "animate-pulse bg-emerald-400" : "bg-rose-400"}`} />
              {!status ? "Checking…" : ready ? "RDP Online • Ready" : online ? "RDP Online — engine starting" : "RDP Offline"}
            </p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">
              {online
                ? "The host agent on the RDP server is checking in and the app is following its current address."
                : "The host agent has not checked in recently. A website cannot switch on a powered-off RDP server — start the server / agent there and this page updates itself."}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex flex-wrap gap-2">
              <button disabled className={disabledBtn} title="Host power is managed on the RDP server itself">Restart Host</button>
              <button disabled className={disabledBtn} title="Host power is managed on the RDP server itself">Sleep Host</button>
            </div>
            <p className="max-w-72 text-xs leading-relaxed text-zinc-500">
              Disabled: there is no website-side power control for the RDP host{online ? "" : " (and the host is offline)"} —
              restart or shut it down on the RDP server itself.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass rounded-3xl p-6">
          <h2 className="font-semibold text-white">Live facts</h2>
          <dl className="mt-3 divide-y divide-white/5">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="text-right font-mono text-xs leading-relaxed text-zinc-200">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">CPU / RAM / uptime are not reported by the host API, so they are not shown here rather than invented.</p>
        </div>

        <div className="glass rounded-3xl p-6">
          <h2 className="font-semibold text-white">RDP host setup</h2>
          <dl className="mt-3 divide-y divide-white/5">
            {setupRows.map(([k, v]) => (
              <div key={k} className="py-2.5 text-sm">
                <dt className="flex items-center gap-2 text-zinc-200">
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300">RDP setup</span>
                  {k}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-zinc-500">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">These rows describe how the host agent is installed on the RDP server — they are setup facts, not live telemetry.</p>
        </div>
      </div>
    </div>
  );
}
