import SessionLive from "@/components/SessionLive";

// Live Browser Session (Stitch frame 2).
export default function SessionPage() {
  return (
    <section className="space-y-5">
      <div>
        <p className="mono-label">Live Session</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Live Browser <span className="text-gradient">Session</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
          Control the running cloud browser: open its stream, send it files, or stop it. The stream itself opens in
          its own tab, exactly like v1.
        </p>
      </div>
      <SessionLive />
    </section>
  );
}
