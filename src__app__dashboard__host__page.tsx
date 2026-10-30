import HostLive from "@/components/HostLive";

// Host / RDP Server — the v2 browser host is an RDP server.
export default function HostPage() {
  return (
    <section className="space-y-5">
      <div>
        <p className="mono-label">Host / RDP Server</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Your <span className="text-gradient">RDP host</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">The server that actually runs your cloud browsers — its live state and how it is set up.</p>
      </div>
      <HostLive />
    </section>
  );
}
