import { NextResponse } from "next/server";
import { db, persist, notify } from "@/lib/db";
import { publicUser } from "@/lib/db";
import { currentSession } from "@/lib/auth";

async function mustAdmin() {
  const s = await currentSession();
  if (!s) return null;
  const d = db();
  const me = d.users.find((u) => u.id === s.id);
  return me && me.role !== "USER" ? { d, me } : null;
}

export async function GET() {
  const ctx = await mustAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { d } = ctx;
  const deals = d.deals
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((x) => {
      const buyer = d.users.find((u) => u.id === x.buyerId);
      const seller = d.users.find((u) => u.id === x.sellerId);
      const msgCount = d.messages.filter((m) => m.dealId === x.id).length;
      return {
        ...x,
        buyer: buyer ? publicUser(buyer) : null,
        seller: seller ? publicUser(seller) : null,
        msgCount,
      };
    });
  return NextResponse.json({ deals });
}

export async function POST(req: Request) {
  const ctx = await mustAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { d } = ctx;
  const body = await req.json().catch(() => ({}));
  const deal = d.deals.find((x) => x.id === body.id);
  if (!deal) return NextResponse.json({ error: "Deal not found." }, { status: 404 });

  const allowed = [
    "Pending", "Negotiating", "Payment Pending", "Payment Received",
    "In Progress", "Delivered", "Completed", "Cancelled", "Disputed",
  ];
  if (body.status && allowed.includes(body.status)) {
    deal.status = body.status;
    if (body.status === "Payment Received") deal.paymentStatus = "Received";
    if (body.status === "Delivered" || body.status === "Completed") deal.deliveryStatus = "Delivered";
    if (body.status === "In Progress" && deal.deliveryStatus === "Pending") deal.deliveryStatus = "In Progress";
    if (body.status === "Completed") {
      // credit reputation (never expose counterparty details)
      const seller = d.users.find((u) => u.id === deal.sellerId);
      if (seller) {
        seller.ratingCount += 1;
        seller.rating = Math.min(5, Math.round(((seller.rating * (seller.ratingCount - 1) + 5) / seller.ratingCount) * 10) / 10);
      }
    }
  }
  if (body.agreedPrice && Number(body.agreedPrice) > 0) {
    deal.agreedPrice = Number(body.agreedPrice);
    deal.commission = Math.round(deal.agreedPrice * 0.08);
    deal.finalAmount = deal.agreedPrice + deal.commission;
  }
  if (body.paymentStatus && ["Pending", "Received", "Refunded"].includes(body.paymentStatus)) {
    deal.paymentStatus = body.paymentStatus;
  }
  if (body.deliveryStatus && ["Pending", "In Progress", "Delivered"].includes(body.deliveryStatus)) {
    deal.deliveryStatus = body.deliveryStatus;
  }
  deal.updatedAt = Date.now();

  notify(deal.buyerId, "🔔", `Deal ${deal.id} updated: ${deal.status}.`, `/app/deals/${deal.id}`);
  notify(deal.sellerId, "🔔", `Deal ${deal.id} updated: ${deal.status}.`, `/app/deals/${deal.id}`);
  persist();
  return NextResponse.json({ ok: true, deal });
}
