import SettingsLive from "@/components/SettingsLive";
import { getSessionUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// Settings — account facts are loaded server-side; interactive parts live
// in SettingsLive.
export default async function SettingsPage() {
  let name = "";
  let email = "";
  let emailVerified = false;
  try {
    const userId = await getSessionUserId();
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, displayName: true, emailVerifiedAt: true }
      });
      if (user) {
        email = user.email;
        name = user.displayName?.trim() || user.email.split("@")[0];
        emailVerified = !!user.emailVerifiedAt;
      }
    }
  } catch { /* layout already guarantees a session; keep blanks on DB hiccup */ }

  return (
    <section className="space-y-5">
      <div>
        <p className="mono-label">Settings</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Account & <span className="text-gradient">browser settings</span>
        </h1>
      </div>
      <SettingsLive name={name} email={email} emailVerified={emailVerified} />
    </section>
  );
}
