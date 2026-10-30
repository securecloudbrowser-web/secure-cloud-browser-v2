import ProfilesLive from "@/components/ProfilesLive";

// Browser Profiles (Stitch): isolated cloud environments with persistent
// logins, cookies, tabs and per-profile browser choice.
export default function ProfilesPage() {
  return (
    <section className="space-y-5">
      <div>
        <p className="mono-label">Browser Profiles</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Isolated profiles, <span className="text-gradient">persistent logins</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
          Each profile keeps its own logins, cookies and tabs on the RDP host. Start, stop, edit or delete a profile
          from its card — up to 5 profiles per account.
        </p>
      </div>
      <ProfilesLive />
    </section>
  );
}
