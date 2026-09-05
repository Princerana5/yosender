import { NextResponse } from "next/server";
import { db, persist, uid, notify } from "@/lib/db";
import { currentSession } from "@/lib/auth";

/** Relay chat: user ↔ admin only. The message is stored on the sender's side. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 1000);
  if (!text) return NextResponse.json({ error: "Message is empty." }, { status: 400 });

  const d = db();
  const deal = d.deals.find((x) => x.id === id);
  if (!deal) return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  const me = d.users.find((u) => u.id === s.id);
  const isAdmin = me?.role !== "USER";
  const isParty = deal.buyerId === s.id || deal.sellerId === s.id;
  if (!isParty && !isAdmin) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  if (["Completed", "Cancelled"].includes(deal.status)) {
    return NextResponse.json({ error: "This deal is closed." }, { status: 400 });
  }

  let side: "buyer" | "seller";
  if (isAdmin) {
    side = body.side === "seller" ? "seller" : "buyer";
  } else {
    side = deal.buyerId === s.id ? "buyer" : "seller";
  }

  const msg = {
    id: uid("m"),
    dealId: id,
    side,
    sender: (isAdmin ? "admin" : "user") as "admin" | "user",
    text,
    createdAt: Date.now(),
  };
  d.messages.push(msg);
  deal.updatedAt = Date.now();

  // Notify the other end of THIS side only (never the counterparty)
  if (isAdmin) {
    const target = side === "buyer" ? deal.buyerId : deal.sellerId;
    notify(target, "💬", `NEVX Admin sent you a message on deal ${deal.id}.`, `/app/deals/${deal.id}`);
  } else {
    for (const a of d.users.filter((u) => u.role !== "USER")) {
      notify(a.id, "💬", `New ${side} message on deal ${deal.id}.`, `/admin/deals/${deal.id}`);
    }
  }
  persist();
  return NextResponse.json({ ok: true, message: msg });
}
