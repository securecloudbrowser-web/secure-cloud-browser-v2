"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Settings: account facts are real (server-passed). "Sign out all
// devices" is wired to the real /api/auth/revoke-all route. Change
// password / 2FA have no backend route in v1 or v2, so they are shown
// disabled + labelled instead of fake-saved. Browser defaults are saved
// on THIS device only (localStorage) and labelled as such — they pre-fill
// your choices; they are not account settings.

const DEFAULTS_KEY = "scb-v2-browser-defaults";

export default function SettingsLive({ name, email, emailVerified }: { name: string; email: string; emailVerified: boolean }) {
  const router = useRouter();
  const [defBrowser, setDefBrowser] = useState("chromium");
  const [defSearch, setDefSearch] = useState("google");
  const [directPaste, setDirectPaste] = useState(true);
  const [savedNote, setSavedNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEFAULTS_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { browser?: string; search?: string; directPaste?: boolean };
        if (d.browser) setDefBrowser(d.browser);
        if (d.search) setDefSearch(d.search);
        if (typeof d.directPaste === "boolean") setDirectPaste(d.directPaste);
      }
    } catch { /* defaults stay */ }
  }, []);

  function saveDefaults() {
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ browser: defBrowser, search: defSearch, directPaste }));
      setSavedNote("Saved on this device only — these are not account settings yet.");
    } catch {
      setSavedNote("Could not save on this device.");
    }
  }

  async function revokeAll() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/auth/revoke-all", { method: "POST" });
      if (res.ok) {
        setMsg("All sessions revoked — taking you to login…");
        router.push("/login");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setMsg(data.error || "Could not revoke sessions.");
      }
    } catch { setMsg("Could not revoke sessions — the site did not answer."); }
    setBusy(false);
  }

  const selectCls = "rounded-full border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-400/60";
  const disabledBtn = "rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="glass rounded-3xl p-6">
        <h2 className="font-semibold text-white">Account</h2>
        <dl className="mt-3 space-y-2.5 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-zinc-500">Name</dt><dd className="text-zinc-100">{name}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-zinc-500">Email</dt><dd className="font-mono text-xs text-zinc-100">{email}</dd></div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Email verified</dt>
            <dd>{emailVerified ? <span className="text-emerald-300">Verified</span> : <span className="text-amber-300">Not verified — check your inbox for the link</span>}</dd>
          </div>
        </dl>
        <div className="mt-5 space-y-3 border-t border-white/5 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">Change password</p>
            <button disabled className={disabledBtn} title="No change-password API exists yet">Disabled — not available yet</button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">Two-factor authentication (2FA)</p>
            <button disabled className={disabledBtn} title="2FA enrollment is not built yet">Disabled — not available yet</button>
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">Password change and 2FA have no backend route yet, so they are labelled and disabled rather than pretending to save.</p>
        </div>
      </div>

      <div className="glass rounded-3xl p-6">
        <h2 className="font-semibold text-white">Security</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">Sign out every device at once — every session for your account is revoked, including this one.</p>
        <button onClick={revokeAll} disabled={busy} className="mt-4 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition hover:opacity-90 disabled:opacity-50">
          {busy ? "Working…" : "Sign out all devices"}
        </button>
        {msg && <p className="mt-3 text-sm text-zinc-300">{msg}</p>}
      </div>

      <div className="glass rounded-3xl p-6 lg:col-span-2">
        <h2 className="font-semibold text-white">Browser defaults</h2>
        <p className="mt-1 text-sm text-zinc-400">Your preferred defaults. Saved on this device only for now (clearly labelled — not synced to your account).</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            Default browser
            <select value={defBrowser} onChange={(e) => setDefBrowser(e.target.value)} className={selectCls}>
              <option value="chromium">Google Chrome</option>
              <option value="firefox">Firefox</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            Search engine
            <select value={defSearch} onChange={(e) => setDefSearch(e.target.value)} className={selectCls}>
              <option value="google">Google</option>
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={directPaste} onChange={(e) => setDirectPaste(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
            Direct Paste (Ctrl+V) in the live stream
          </label>
          <button onClick={saveDefaults} className="btn-primary">Save defaults</button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Google is the enforced search engine on the RDP host in both Chrome and Firefox, so it is the only option listed. Direct Paste is a stream feature — this toggle records your preference on this device.</p>
        {savedNote && <p className="mt-2 text-sm text-zinc-300">{savedNote}</p>}
      </div>
    </div>
  );
}
