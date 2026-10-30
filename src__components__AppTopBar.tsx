"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import UserMenu from "@/components/UserMenu";

// Stitch top bar: profile search (routes to the Profiles page filter),
// Direct Paste shortcut (the live-session page explains/enables it), a
// New Profile action, and the session-aware user menu.
export default function AppTopBar({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        className="min-w-52 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/dashboard/profiles${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search profiles…"
          aria-label="Search profiles"
          className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/30"
        />
      </form>
      <a
        href="/dashboard/session"
        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/20"
        title="Direct Paste (Ctrl+V) works inside the live browser session"
      >
        Direct Paste
      </a>
      <a href="/dashboard/profiles#new-profile" className="btn-primary">
        + New Profile
      </a>
      <UserMenu name={name} email={email} />
    </div>
  );
}
