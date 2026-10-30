"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Files & Downloads: the real file flow in this app is the profile Inbox —
// files are sent INTO a profile on the RDP host via /api/browser/inbox and
// picked up from the browser's own file picker; downloads happen inside
// the cloud browser itself. This page wires the upload side per profile
// and lists what YOU sent during this visit (the host exposes no Inbox
// listing API, so nothing is invented beyond that).

type Profile = { id: string; name: string; browser: string };
type Sent = { name: string; profile: string; at: string };

export default function FilesLive() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [sent, setSent] = useState<Sent[]>([]);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
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

  async function upload(file: File) {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    setMsg("Sending file…");
    try {
      const form = new FormData();
      form.set("profileId", profile.id);
      form.set("file", file);
      const res = await fetch("/api/browser/inbox", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const name = typeof data.name === "string" ? data.name : file.name;
        setSent((s) => [{ name, profile: profile.name, at: new Date().toLocaleTimeString() }, ...s]);
        setMsg(`Sent “${name}” to ${profile.name}'s Inbox on the RDP host.`);
      } else if (data.error === "file_too_large") {
        setMsg("That file is too large — the Inbox limit is 25 MB.");
      } else {
        setMsg(data.error || data.message || "Upload failed.");
      }
    } catch {
      setMsg("Upload failed — the RDP host did not answer.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-3xl p-6">
        <h2 className="font-semibold text-white">Send a file to a profile (Inbox)</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400">
          The file lands in that profile's Inbox folder on the RDP host — inside the cloud browser, open any file
          picker and choose the Inbox folder. Max 25 MB per file.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="Profile" className="rounded-full border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-400/60">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={!profileId} className="btn-primary">Choose file & send</button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          {profiles.length === 0 && <p className="text-sm text-zinc-500">No profiles yet — create one first.</p>}
        </div>
        {msg && <p className="mt-3 text-sm text-zinc-300">{msg}</p>}
      </div>

      <div className="glass rounded-3xl p-6">
        <h2 className="font-semibold text-white">Sent this visit</h2>
        {sent.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing sent yet in this visit. The RDP host does not expose an Inbox file listing, so this list only
            tracks uploads made from this page — it is not a full file manager.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {sent.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="font-mono text-zinc-200">{s.name}</span>
                <span className="text-xs text-zinc-500">{s.profile} · {s.at}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-zinc-400">
          <span className="font-medium text-zinc-200">Downloads:</span> files you download inside the cloud browser
          stay in that profile on the RDP host (its Downloads folder) — there is no separate download-to-this-device
          step in this version.
        </p>
      </div>
    </div>
  );
}
