import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { db, publicUser } from "@/lib/db";
import AppShell from "./shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const token = jar.get("nevx_session")?.value;
  const sess = token ? await verifyToken(token) : null;
  const d = db();
  const u = sess ? d.users.find((x) => x.id === sess.sub && x.status === "ACTIVE") : null;
  if (!u) redirect("/login");

  const unread = d.notifications.filter((n) => n.userId === u.id && !n.read).length;
  const activeDeals = d.deals.filter(
    (x) => (x.buyerId === u.id || x.sellerId === u.id) && !["Completed", "Cancelled"].includes(x.status)
  ).length;

  return (
    <AppShell
      me={{ ...publicUser(u), email: u.email, role: u.role }}
      unread={unread}
      activeDeals={activeDeals}
      groups={d.groups.filter((g) => g.active).sort((a, b) => a.order - b.order)}
    >
      {children}
    </AppShell>
  );
}
