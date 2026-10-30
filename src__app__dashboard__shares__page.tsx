import SharesLive from "@/components/SharesLive";

// Shared Links: share a browser profile without sharing its passwords.
export default function SharesPage() {
  return (
    <section className="space-y-5">
      <div>
        <p className="mono-label">Shared Links</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Share the browser, <span className="text-gradient">not the password</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
          Create a time-limited link for one of your profiles — View Only or Full Control — and revoke it any time.
        </p>
      </div>
      <SharesLive />
    </section>
  );
}
