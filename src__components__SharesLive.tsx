"use client";
import { useCallback, useEffect, useState } from "react";

// Shared Links page: create / list / revoke profile share links backed by
// /api/browser/shares (ProfileShare rows, token stored hashed). The raw
// link is shown ONCE at creation — it cannot be recovered later, only
// revoked and re-created.

type Share = {
  id: string;
  profileId: string;
  profileName: string | null;
  permission: "VIEW_ONLY" | "FULL_CONTROL";
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  state: "active" | "expired" | "revoked";
};
type Profile = { id: string; name: string; browser: string };

export default function SharesLive() {
  const [shares, setShares] = useState<Share[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [permission, setPermission] = useState("VIEW_ONLY");
  const [expiry, setExpiry] = useState("7d");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newLink, setNewLink] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/browser/shares");
      if (res.ok) setShares((await res.json()).shares ?? []);
    } catch { /* keep last state */ }
    try {
      const res = await fetch("/api/browser/profiles");
      if (res.ok) {
        const list: Profile[] = (await res.json()).profiles ?? [];
        setProfiles(list);
        setProfileId((cur) => cur || list[0]?.id || "");
      }
    } catch { /* keep last state */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true); setMsg(""); setNewLink("");
    try {
      const res = await fetch("/api/browser/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId, permission, expiry })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.shareUrl) {
        setNewLink(data.shareUrl);
        setMsg("Share link created — copy it now, it is shown only once.");
      } else setMsg(data.error || "Share could not be created.");
    } catch { setMsg("Share could not be created — the site did not answer."); }
    setBusy(false); load();
  }

  async function revoke(id: string) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/browser/shares", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? "Share link revoked." : data.error || "Revoke failed.");
    } catch { setMsg("Revoke failed — the site did not answer."); }
    setBusy(false); load();
  }

  const inputCls = "rounded-full border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-400/60";

  return (
    <div className="space-y-4">
      <div className="glass rounded-3xl p-6">
        <h2 className="font-semibold text-white">Create a share link</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          Anyone with the link can see that this profile is shared and its permission level — the link alone never
          opens the browser or reveals your passwords; a guest still needs an account session to enter.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className={inputCls} aria-label="Profile">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select value={permission} onChange={(e) => setPermission(e.target.value)} className={inputCls} aria-label="Permission">
            <option value="VIEW_ONLY">View Only</option>
            <option value="FULL_CONTROL">Full Control</option>
          </select>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} aria-label="Expiry">
            <option value="1h">Expires in 1 hour</option>
            <option value="24h">Expires in 1 day</option>
            <option value="7d">Expires in 7 days</option>
            <option value="never">Never expires</option>
          </select>
          <button onClick={create} disabled={busy || !profileId} className="btn-primary">{busy ? "Working…" : "Create link"}</button>
        </div>
        {profiles.length === 0 && <p className="mt-3 text-sm text-zinc-500">No profiles yet — create a profile first, then share it.</p>}
        {newLink && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3">
            <code className="min-w-52 flex-1 break-all font-mono text-xs text-cyan-100">{newLink}</code>
            <button onClick={() => navigator.clipboard?.writeText(newLink).catch(() => {})} className="rounded-full border border-cyan-400/30 px-4 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/10">
              Copy link
            </button>
          </div>
        )}
        {msg && <p className="mt-3 text-sm text-zinc-300">{msg}</p>}
      </div>

      <div className="glass rounded-3xl p-6">
        <h2 className="font-semibold text-white">Your share links</h2>
        {shares.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No share links yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {shares.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium text-zinc-100">{s.profileName ?? "Profile"}</p>
                  <p className="mt-0.5 font-mono text-xs text-zinc-500">
                    {s.permission === "FULL_CONTROL" ? "Full Control" : "View Only"} · created {new Date(s.createdAt).toLocaleString()} · {s.expiresAt ? `expires ${new Date(s.expiresAt).toLocaleString()}` : "no expiry"}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${s.state === "active" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/5 text-zinc-400"}`}>
                  {s.state}
                </span>
                {s.state === "active" && (
                  <button onClick={() => revoke(s.id)} disabled={busy} className="rounded-full border border-rose-400/30 bg-rose-400/5 px-4 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-50">
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
