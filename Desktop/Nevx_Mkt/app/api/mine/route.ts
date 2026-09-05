import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentSession } from "@/lib/auth";

/** Everything the logged-in user needs for My Requests / My Offers / Applications / Deals / Notifications */
export async function GET() {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const d = db();
  const me = d.users.find((u) => u.id === s.id);
  const users = new Map(d.users.map((u) => [u.id, u]));
  const needs = new Map(d.needs.map((n) => [n.id, n]));

  const myNeeds = d.needs.filter((n) => n.userId === s.id).sort((a, b) => b.createdAt - a.createdAt);
  const myOffers = d.offers.filter((o) => o.userId === s.id).sort((a, b) => b.createdAt - a.createdAt);
  const myApplications = d.applications
    .filter((a) => a.applicantId === s.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((a) => {
      const n = needs.get(a.needId);
      const u = n ? users.get(n.userId) : undefined;
      return {
        ...a,
        need: n ? { id: n.id, title: n.title, budgetMin: n.budgetMin, budgetMax: n.budgetMax, category: n.category } : null,
        requester: u ? { id: u.id, name: u.name, country: u.country } : null,
      };
    });
  // Applications received on my needs (applicant identity shown, no private contact)
  const received = d.applications
    .filter((a) => needs.get(a.needId)?.userId === s.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((a) => {
      const n = needs.get(a.needId)!;
      const u = users.get(a.applicantId);
      return {
        ...a,
        need: { id: n.id, title: n.title },
        applicant: u
          ? { id: u.id, name: u.name, country: u.country, avatarColor: u.avatarColor, rating: u.rating }
          : null,
      };
    });
  const myDeals = d.deals
    .filter((x) => x.buyerId === s.id || x.sellerId === s.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((x) => ({
      ...x,
      role: x.buyerId === s.id ? "buyer" : "seller",
    }));
  const notifications = d.notifications
    .filter((n) => n.userId === s.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
  const unread = notifications.filter((n) => !n.read).length;
  const activeDeals = myDeals.filter((x) => !["Completed", "Cancelled"].includes(x.status));

  return NextResponse.json({
    myNeeds,
    myOffers,
    myApplications,
    received,
    myDeals,
    activeDeals,
    notifications,
    unread,
    isAdmin: me ? me.role !== "USER" : false,
    stats: {
      needs: myNeeds.length,
      offers: myOffers.length,
      deals: myDeals.filter((x) => x.status === "Completed").length,
    },
  });
}
