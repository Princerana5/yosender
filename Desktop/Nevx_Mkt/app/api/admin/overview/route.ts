import { NextResponse } from "next/server";
import { db, publicUser } from "@/lib/db";
import { currentSession } from "@/lib/auth";

export async function GET() {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const d = db();
  const me = d.users.find((u) => u.id === s.id);
  if (!me || me.role === "USER") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const activeDeals = d.deals.filter((x) => !["Completed", "Cancelled"].includes(x.status));
  const revenue = d.deals
    .filter((x) => x.status === "Completed")
    .reduce((sum, x) => sum + x.commission, 0);

  return NextResponse.json({
    stats: {
      totalUsers: d.users.length,
      activeUsers: d.users.filter((u) => u.status === "ACTIVE").length,
      totalNeeds: d.needs.filter((n) => n.status === "ACTIVE").length,
      totalOffers: d.offers.filter((o) => o.status === "ACTIVE").length,
      pendingApplications: d.applications.filter((a) => a.status === "PENDING").length,
      activeDeals: activeDeals.length,
      completedDeals: d.deals.filter((x) => x.status === "Completed").length,
      cancelledDeals: d.deals.filter((x) => x.status === "Cancelled").length,
      revenue,
      openReports: d.reports.filter((r) => r.status === "OPEN").length,
    },
    recentApplications: d.applications.slice(0, 8).map((a) => {
      const need = d.needs.find((n) => n.id === a.needId);
      const ap = d.users.find((u) => u.id === a.applicantId);
      return {
        ...a,
        need: need ? { id: need.id, title: need.title } : null,
        applicant: ap ? publicUser(ap) : null,
      };
    }),
    activeDealsList: activeDeals.slice(0, 8),
  });
}
