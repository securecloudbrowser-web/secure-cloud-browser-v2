import { getSessionUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// Activity & Logs — the signed-in user's own rows from the append-only
// AuditLog (written by the auth, browser, share and settings routes).
export default async function ActivityPage() {
  let logs: { id: string; action: string; targetType: string | null; createdAt: Date }[] = [];
  try {
    const userId = await getSessionUserId();
    if (userId) {
      logs = await prisma.auditLog.findMany({
        where: { actorId: userId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, action: true, targetType: true, createdAt: true }
      });
    }
  } catch {
    logs = [];
  }

  return (
    <section className="space-y-5">
      <div>
        <p className="mono-label">Activity & Logs</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Everything that <span className="text-gradient">happened</span>
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
          Logins, browser launches and stops, share creation and revokes — from the append-only audit log. Only your
          own activity is shown.
        </p>
      </div>

      <div className="glass rounded-3xl p-6">
        {logs.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1 font-mono text-xs text-indigo-200">{l.action}</span>
                {l.targetType && <span className="font-mono text-xs text-zinc-500">{l.targetType}</span>}
                <span className="ml-auto text-xs text-zinc-500">{l.createdAt.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
