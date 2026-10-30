import FilesLive from "@/components/FilesLive";

// Files & Downloads — Inbox uploads to profiles on the RDP host.
export default function FilesPage() {
  return (
    <section className="space-y-5">
      <div>
        <p className="mono-label">Files & Downloads</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Files for your <span className="text-gradient">cloud browser</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">Send files into a profile's Inbox on the RDP host, ready to use inside the browser.</p>
      </div>
      <FilesLive />
    </section>
  );
}
