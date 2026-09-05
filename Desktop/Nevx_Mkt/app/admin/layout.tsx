import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { db } from "@/lib/db";
import AdminShell from "./shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const token = jar.get("nevx_session")?.value;
  const sess = token ? await verifyToken(token) : null;
  const d = db();
  const u = sess ? d.users.find((x) => x.id === sess.sub) : null;
  if (!u || u.role === "USER" || u.status !== "ACTIVE") redirect("/login");

  const pendingApps = d.applications.filter((a) => a.status === "PENDING").length;
  const openReports = d.reports.filter((r) => r.status === "OPEN").length;
  const activeDeals = d.deals.filter((x) => !["Completed", "Cancelled"].includes(x.status)).length;

  return (
    <AdminShell me={{ id: u.id, name: u.name, role: u.role }} pendingApps={pendingApps} openReports={openReports} activeDeals={activeDeals}>
      {children}
    </AdminShell>
  );
}
