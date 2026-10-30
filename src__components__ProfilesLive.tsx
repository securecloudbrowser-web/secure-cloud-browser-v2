"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BrowserPanel, { type Status } from "@/components/BrowserPanel";

// Browser Profiles page body (Stitch): header stats come from the same
// single status fetch that feeds the panel; the search/filter bar filters
// the panel's cards (query + browser engine).

function ProfilesInner() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [browserFilter, setBrowserFilter] = useState("all");

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
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const count = status?.profiles?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search profiles by name…"
          aria-label="Search profiles"
          className="min-w-52 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400/60"
        />
        <select
          value={browserFilter}
          onChange={(e) => setBrowserFilter(e.target.value)}
          aria-label="Filter by browser"
          className="rounded-full border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-400/60"
        >
          <option value="all">All browsers</option>
          <option value="chromium">Google Chrome</option>
          <option value="firefox">Firefox</option>
        </select>
        <span className="mono-label rounded-full border border-white/10 bg-white/5 px-3 py-2 normal-case tracking-normal">
          {status ? `${count} of 5 profiles used · ${5 - count} slots available` : "Checking…"}
        </span>
      </div>

      <div id="new-profile">
        <BrowserPanel status={status} refresh={load} query={query} browserFilter={browserFilter} />
      </div>

      <div className="glass flex flex-wrap items-center gap-3 rounded-3xl p-5 text-sm text-zinc-400">
        <p className="min-w-56 flex-1">
          <span className="font-medium text-zinc-200">Import / Export:</span> profile data lives on the RDP host and in your
          account — there is no profile archive download in this version, so export is shown disabled rather than faked.
        </p>
        <button disabled className="rounded-full border border-white/15 bg-white/5 px-4 py-2 font-medium text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60" title="Profile export is not available in this version">
          Export profiles — not available yet
        </button>
        <button disabled className="rounded-full border border-white/15 bg-white/5 px-4 py-2 font-medium text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60" title="Profile import is not available in this version">
          Import profile — not available yet
        </button>
      </div>
    </div>
  );
}

export default function ProfilesLive() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading profiles…</p>}>
      <ProfilesInner />
    </Suspense>
  );
}
