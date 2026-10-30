import { redirect } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import AppTopBar from "@/components/AppTopBar";
import { getSessionUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// Authenticated app shell (Stitch): left sidebar + top bar around every
// /dashboard page. Unauthenticated visitors are sent to /login — the same
// session cookie every API route checks.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let user: { name: string; email: string } | null = null;
  try {
    const userId = await getSessionUserId();
    if (userId) {
      const row = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });
      if (row) user = { name: row.displayName?.trim() || row.email.split("@")[0], email: row.email };
    }
  } catch {
    user = null;
  }
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col lg:min-h-screen lg:flex-row">
      <aside className="shrink-0 border-b border-white/5 bg-white/[0.015] lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r">
        <AppSidebar />
      </aside>
      <div className="min-w-0 flex-1 px-4 py-5 sm:px-6">
        <AppTopBar name={user.name} email={user.email} />
        <main className="mt-6">{children}</main>
      </div>
    </div>
  );
}
