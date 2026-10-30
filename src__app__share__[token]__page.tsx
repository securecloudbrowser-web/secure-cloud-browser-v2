import { hashToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/prisma";

// Public share-link landing: resolves the link's token HASH (the raw token
// is never stored) and reports the share's honest state. The link alone
// NEVER opens a browser and never exposes the owner's passwords, cookies
// or credentials — entering a shared profile still requires signing in.
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let state: "active" | "expired" | "revoked" | "notfound" = "notfound";
  let profileName: string | null = null;
  let permission: string | null = null;
  let expiresAt: Date | null = null;
  try {
    const share = await prisma.profileShare.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { profile: { select: { name: true } } }
    });
    if (share) {
      profileName = share.profile.name;
      permission = share.permission === "INTERACTIVE" ? "Full Control" : "View Only";
      expiresAt = share.expiresAt;
      state = share.revokedAt ? "revoked" : share.expiresAt && share.expiresAt < new Date() ? "expired" : "active";
    }
  } catch {
    state = "notfound";
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-4 py-16">
      <div className="glass w-full rounded-3xl p-8 text-center shadow-2xl shadow-black/50">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-400 shadow-lg shadow-indigo-500/30">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" />
            <path d="M8.6 10.6l6.8-3.2M8.6 13.4l6.8 3.2" />
          </svg>
        </span>
        {state === "active" ? (
          <>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">A browser profile was shared with you</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Profile <span className="font-medium text-zinc-100">“{profileName}”</span> · Permission:{" "}
              <span className="font-medium text-zinc-100">{permission}</span>
              {expiresAt ? <> · Expires {expiresAt.toLocaleString()}</> : <> · No expiry</>}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Sign in (or create a free account) to continue. The owner's passwords, cookies and credentials are
              never shown to you — sharing is access to the browser, not to the secrets inside it.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <a href="/login" className="btn-primary">Log in to continue</a>
              <a href="/register" className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10">Create an account</a>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">
              {state === "revoked" ? "This share link was revoked" : state === "expired" ? "This share link has expired" : "Share link not found"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {state === "notfound"
                ? "This link doesn't match any share. Check that you copied the full link, or ask the owner for a new one."
                : "Ask the profile's owner to create a new share link if you still need access."}
            </p>
            <a href="/" className="btn-primary mt-6 inline-block">Go to Secure Cloud Browser</a>
          </>
        )}
      </div>
    </main>
  );
}
