"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      // Success: go straight to the dashboard (the session cookie is set).
      setMsg("Logged in — taking you to your dashboard…");
      router.push("/dashboard");
      router.refresh();
    } else {
      setMsg(data.error || "Login failed — is the database running?");
    }
  }
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <form onSubmit={submit} className="glass space-y-5 rounded-3xl p-8 shadow-2xl shadow-black/50">
        <div className="space-y-2 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-lg shadow-indigo-500/30">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Log in</h1>
          <p className="text-sm text-zinc-400">Access your cloud browser dashboard.</p>
        </div>
        <label className="block text-sm font-medium text-zinc-300">
          Email
          <input name="email" type="email" required placeholder="you@example.com" className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-zinc-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40" />
        </label>
        <label className="block text-sm font-medium text-zinc-300">
          Password
          <input name="password" type="password" required placeholder="••••••••••" className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-zinc-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40" />
        </label>
        <button className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 py-2.5 font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:opacity-90">Log in</button>
        {msg && <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">{msg}</p>}
        <p className="text-center text-sm text-zinc-400">
          New to Secure Cloud Browser?{" "}
          <a href="/register" className="font-medium text-indigo-300 transition hover:text-indigo-200">Create an account</a>
        </p>
      </form>
    </div>
  );
}
