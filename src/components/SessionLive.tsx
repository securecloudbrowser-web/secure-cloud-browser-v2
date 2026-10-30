"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "@/components/BrowserPanel";

// Live Browser Session page (Stitch): a session toolbar (connected pill,
// session clock, Direct Paste note, quality/keyboard/screenshot labels,
// real upload-to-Inbox, fullscreen hint, Stop) above the stream area.
// The REAL stream opens via /api/browser/launch -> streamUrl in its own
// tab (the v1-proven flow); this page controls and explains that session
// honestly — controls that only exist inside the stream window are
// disabled + labelled here, never faked.

export default function SessionLive() {
  const [status, setStatus] = useState<Status | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/browser/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // keep last honest state
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  const profiles = status?.profiles ?? [];
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles.find((p) => p.running) ?? profiles[0] ?? null;
  const hostReady = !!status?.configured && !!status?.hostOnline && !!status?.dockerReady;
  const startedAt = selected?.session?.startedAt ? new Date(selected.session.startedAt).getTime() : null;
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;
  const elapsedText = elapsed === null ? "—" : `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  async function openSession(force = false) {
    if (!selected) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: selected.id, ...(force ? { force: true } : selected.running ? { mode: "attach" } : {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.streamUrl) {
        window.open(data.streamUrl, "_blank", "noopener");
        setMsg("Live session opened in a new tab — keep this page open to control it.");
      } else if (res.status === 409 && data.error === "session_in_use") {
        setMsg("This profile's session is live with its screen connected elsewhere. Use “Force new session” only if you want that screen closed.");
      } else {
        setMsg(data.error || "Could not open the session.");
      }
    } catch {
      setMsg("Could not open the session — the RDP host did not answer.");
    }
    setBusy(false);
    load();
  }

  async function stopSession() {
    if (!selected) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/browser/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: selected.id })
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? "Browser stopped — profile and logins are saved on the RDP host." : data.error || "Stop failed.");
    } catch {
      setMsg("Stop failed — the RDP host did not answer.");
    }
    setBusy(false);
    load();
  }

  async function upload(file: File) {
    if (!selected) return;
    setMsg("Sending file to the profile's Inbox…");
    try {
      const form = new FormData();
      form.set("profileId", selected.id);
      form.set("file", file);
      const res = await fetch("/api/browser/inbox", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? `File sent: ${typeof data.name === "string" ? data.name : file.name} — find it in the Inbox folder inside the browser's file picker.` : data.error || "Upload failed.");
    } catch {
      setMsg("Upload failed — the RDP host did not answer.");
    }
  }

  const disabledCls = "rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="glass rounded-3xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${selected?.running ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/5 text-zinc-400"}`}>
            <span className={`h-2 w-2 rounded-full ${selected?.running ? "animate-pulse bg-emerald-400" : "bg-zinc-500"}`} />
            {selected?.running ? "STREAM CONNECTED" : "NOT RUNNING"}
          </span>
          <span className="mono-label normal-case tracking-normal">Session {elapsedText}</span>
          <span className="mono-label hidden normal-case tracking-normal sm:block">Latency / FPS: not reported by host</span>

          <select
            value={selected?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Choose profile"
            className="rounded-full border border-white/10 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white outline-none"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.browser === "firefox" ? "Firefox" : "Chrome"}){p.running ? " — running" : ""}
              </option>
            ))}
          </select>

          <span className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

          <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3.5 py-2 text-xs font-medium text-cyan-200" title="Inside the live stream window, plain Ctrl+V pastes directly — no clipboard box needed">
            Direct Paste · Ctrl+V in stream
          </span>
          <button disabled className={disabledCls} title="Quality is chosen inside the live stream window">Quality: in stream window</button>
          <button disabled className={disabledCls} title="The on-screen keyboard lives inside the live stream window">Keyboard: in stream window</button>
          <button disabled className={disabledCls} title="Screenshots are taken inside the live stream window">Screenshot: in stream window</button>
          <button onClick={() => fileRef.current?.click()} disabled={!selected} className="rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50">
            Upload to Inbox
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          <button disabled className={disabledCls} title="Downloads happen inside the browser in the stream window">Download: in stream window</button>
          <button disabled className={disabledCls} title="Use the stream window's own fullscreen button">Fullscreen: in stream window</button>

          {selected?.running ? (
            <button onClick={stopSession} disabled={busy} className="rounded-full bg-rose-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-500/25 transition hover:opacity-90 disabled:opacity-50">
              {busy ? "Working…" : "Stop / Terminate"}
            </button>
          ) : null}
        </div>
        {msg && <p className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200">{msg}</p>}
      </div>

      {/* Stream area */}
      <div className="glass overflow-hidden rounded-3xl">
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <span className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-rose-400/80" />
            <span className="h-3 w-3 rounded-full bg-amber-300/80" />
            <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
          </span>
          <span className="mono-label normal-case tracking-normal">
            {selected ? `${selected.name} · ${selected.browser === "firefox" ? "Firefox" : "Google Chrome"} · RDP host` : "No profile"}
          </span>
          <span className={`ml-auto inline-flex items-center gap-1.5 text-xs ${hostReady ? "text-emerald-300" : "text-rose-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${hostReady ? "bg-emerald-400" : "bg-rose-400"}`} />
            {hostReady ? "RDP Online" : "RDP Offline"}
          </span>
        </div>
        <div className="bg-dots flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center">
          {!selected ? (
            <p className="max-w-md text-sm leading-relaxed text-zinc-400">No profiles yet — create one on the Browser Profiles page first.</p>
          ) : selected.running ? (
            <>
              <p className="max-w-md text-sm leading-relaxed text-zinc-300">
                <span className="font-medium text-white">{selected.name}</span> is running on the RDP host
                {selected.session?.streamConnected ? " and its screen is connected." : "."} The live picture opens in its
                own stream tab (the proven v1 flow) — mouse, keyboard and direct Ctrl+V paste work there.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button onClick={() => openSession()} disabled={busy} className="btn-primary">{busy ? "Working…" : "Open Live Session"}</button>
                <button onClick={() => openSession(true)} disabled={busy} className="rounded-full border border-rose-400/30 bg-rose-400/5 px-5 py-2.5 text-sm font-medium text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-50">
                  Force new session
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="max-w-md text-sm leading-relaxed text-zinc-400">
                <span className="font-medium text-zinc-200">{selected.name}</span> is stopped. Start it to open the live
                browser on the RDP host — your saved logins and tabs come back with it.
              </p>
              <button onClick={() => openSession()} disabled={busy || !hostReady} className="btn-primary" title={hostReady ? "Start this profile" : "Available when the RDP host is online"}>
                {busy ? "Starting…" : "▶ Start & Open Live Session"}
              </button>
              {!hostReady && <p className="text-xs text-zinc-500">Start is disabled because the RDP host is offline.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
