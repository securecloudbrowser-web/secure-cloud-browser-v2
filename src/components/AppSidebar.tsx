"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Status } from "@/components/BrowserPanel";

// Stitch app shell — left sidebar: logo "Secure Cloud" + "v2.4 Pro", nav,
// and the RDP host status card pinned at the bottom (host state + profile
// quota from the SAME /api/browser/status the dashboard uses; CPU/RAM are
// not reported by the host API, so they are labelled as such, not faked).

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  { href: "/dashboard/profiles", label: "Browser Profiles", icon: "M4 5h16v14H4zM4 9h16" },
  { href: "/dashboard/session", label: "Live Session", icon: "M10 8.5v7l6-3.5zM12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" },
  { href: "/dashboard/shares", label: "Shared Links", icon: "M8.6 10.6l6.8-3.2M8.6 13.4l6.8 3.2M6 12a3 3 0 1 0 0 .01M18 6a3 3 0 1 0 0 .01M18 18a3 3 0 1 0 0 .01" },
  { href: "/dashboard/files", label: "Files & Downloads", icon: "M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" },
  { href: "/dashboard/activity", label: "Activity & Logs", icon: "M3 12h4l2.5-6 4 12L16 12h5" },
  { href: "/dashboard/host", label: "Host / RDP Server", icon: "M4 5h16v11H4zM2 20h20M12 16v4" },
  { href: "/dashboard/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1m0-14.2L17 6.9M7 17l-2.1 2.1" }
];

export function Logo() {
  return (
    <a href="/dashboard" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-lg shadow-indigo-500/30">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block font-semibold tracking-tight text-white">
          Secure <span className="text-gradient">Cloud</span>
        </span>
        <span className="mono-label block">v2.4 Pro</span>
      </span>
    </a>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/browser/status");
        if (alive && res.ok) setStatus(await res.json());
      } catch {
        // keep last honest state
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const online = !!status?.hostOnline && !!status?.dockerReady;
  const profileCount = status?.profiles?.length ?? null;

  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <Logo />
      <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {NAV.map((item) => {
          const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          return (
            <a
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${
                active
                  ? "bg-gradient-to-r from-indigo-500/25 to-violet-500/10 font-medium text-white shadow-inner shadow-indigo-500/10"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              {item.label}
              {item.href === "/dashboard/session" && status?.running ? (
                <span className="mono-label ml-auto hidden rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300 lg:block">Live</span>
              ) : null}
            </a>
          );
        })}
      </nav>

      {/* RDP host mini status — pinned to the sidebar bottom on desktop */}
      <div className="glass mt-auto hidden rounded-2xl p-4 lg:block">
        <div className="flex items-center justify-between gap-2">
          <p className="mono-label">RDP Host</p>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              !status
                ? "border-white/10 bg-white/5 text-zinc-400"
                : online
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-rose-400/30 bg-rose-400/10 text-rose-300"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "animate-pulse bg-emerald-400" : "bg-zinc-500"}`} />
            {!status ? "Checking…" : online ? "RDP Online" : "RDP Offline"}
          </span>
        </div>
        <dl className="mt-3 space-y-1.5 text-xs text-zinc-400">
          <div className="flex justify-between">
            <dt>Profiles used</dt>
            <dd className="font-mono text-zinc-200">{profileCount === null ? "—" : `${profileCount} / 5`}</dd>
          </div>
          <div className="flex justify-between">
            <dt>CPU / RAM</dt>
            <dd className="font-mono text-zinc-500">not reported by host</dd>
          </div>
          <div className="flex justify-between">
            <dt>Last seen</dt>
            <dd className="font-mono text-zinc-200">
              {online ? "now" : status?.hostLastSeenAt ? new Date(status.hostLastSeenAt).toLocaleTimeString() : "—"}
            </dd>
          </div>
        </dl>
        <a href="/dashboard/host" className="mt-3 block text-xs font-medium text-indigo-300 transition hover:text-indigo-200">
          Open Host / RDP page →
        </a>
      </div>
    </div>
  );
}
