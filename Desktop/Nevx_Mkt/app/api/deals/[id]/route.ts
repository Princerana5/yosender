import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentSession } from "@/lib/auth";

/**
 * Deal detail.
 * MEDIATION RULE: buyers/sellers never learn each other's identity beyond
 * first name + country. No email, no phone, no telegram of the counterparty.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const d = db();
  const deal = d.deals.find((x) => x.id === id);
  if (!deal) return NextResponse.json({ error: "Deal not found." }, { status: 404 });

  const isAdmin = d.users.find((u) => u.id === s.id)?.role !== "USER";
  const isParty = deal.buyerId === s.id || deal.sellerId === s.id;
  if (!isParty && !isAdmin) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const users = new Map(d.users.map((u) => [u.id, u]));
  const need = d.needs.find((n) => n.id === deal.needId);
  const app = d.applications.find((a) => a.id === deal.applicationId);
  const mask = (uId: string) => {
    const u = users.get(uId);
    if (!u) return null;
    return {
      id: u.id,
      name: isAdmin || u.id === s.id ? u.name : u.name.split(" ")[0],
      country: u.country,
      avatarColor: u.avatarColor,
    };
  };

  let messages = d.messages
    .filter((m) => m.dealId === id)
    .sort((a, b) => a.createdAt - b.createdAt);
  // Non-admin parties only see their own side of the relay chat
  if (!isAdmin) {
    const side = deal.buyerId === s.id ? "buyer" : "seller";
    messages = messages.filter((m) => m.side === side);
  }

  return NextResponse.json({
    deal: {
      ...deal,
      role: !isAdmin ? (deal.buyerId === s.id ? "buyer" : "seller") : "admin",
      buyer: mask(deal.buyerId),
      seller: mask(deal.sellerId),
    },
    need: need
      ? { id: need.id, title: need.title, description: need.description, category: need.category }
      : null,
    application: app
      ? { id: app.id, price: app.price, deliveryTime: app.deliveryTime, message: app.message, status: app.status }
      : null,
    messages,
    isAdmin,
  });
}
