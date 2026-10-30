import DashboardLive from "@/components/DashboardLive";
import { getSessionUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// Dashboard home (Stitch) — the live section is rendered by DashboardLive,
// which fetches /api/browser/status ONCE and feeds the host banner, metric
// cards, Quick Reconnect and the profiles panel from that single response.
// Shared Links / Stream Time / Recent activity below are real DB values
// computed here server-side (the layout already redirected signed-out
// visitors to /login).

export default async function DashboardPage() {
  let name = "there";
  let sharedLinks = 0;
  let streamHours = 0;
  let recent: { id: string; action: string; createdAt: Date }[] = [];
  try {
    const userId = await getSessionUserId();
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });
      if (user) name = user.displayName?.trim() || user.email.split("@")[0];
      sharedLinks = await prisma.profileShare.count({
        where: { ownerId: userId, revokedAt: null, tokenHash: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
      });
      const sessions = await prisma.browserSession.findMany({
        where: { profile: { ownerId: userId }, stoppedAt: { not: null } },
        select: { startedAt: true, stoppedAt: true },
        take: 500
      });
      streamHours = sessions.reduce((sum, s) => sum + Math.max(0, (s.stoppedAt!.getTime() - s.startedAt.getTime()) / 3600000), 0);
      recent = await prisma.auditLog.findMany({ where: { actorId: userId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, action: true, createdAt: true } });
    }
  } catch {
    // DB hiccup: keep honest defaults (zeros / empty) rather than fake data.
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="mono-label">Dashboard</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Welcome back, <span className="text-gradient">{name}</span>
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">Your cloud browsers on the RDP host — sessions, profiles and sharing in one place.</p>
      </div>

      <DashboardLive sharedLinks={sharedLinks} streamHours={streamHours} />

      <div className="glass rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-white">Recent activity</h2>
          <a href="/dashboard/activity" className="text-sm font-medium text-indigo-300 transition hover:text-indigo-200">View all →</a>
        </div>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No activity yet — logins, launches, shares and revokes will appear here from the append-only audit log.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="font-mono text-zinc-300">{r.action}</span>
                <span className="text-xs text-zinc-500">{r.createdAt.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
