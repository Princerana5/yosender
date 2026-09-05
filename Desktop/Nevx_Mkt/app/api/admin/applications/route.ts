import { NextResponse } from "next/server";
import { db, persist, notify, nextDealId } from "@/lib/db";
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
  const apps = d.applications
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((a) => {
      const need = d.needs.find((n) => n.id === a.needId);
      const req = need ? d.users.find((u) => u.id === need.userId) : undefined;
      const ap = d.users.find((u) => u.id === a.applicantId);
      return {
        ...a,
        need: need ? { id: need.id, title: need.title, category: need.category } : null,
        requester: req ? publicUser(req) : null,
        applicant: ap ? publicUser(ap) : null,
      };
    });
  return NextResponse.json({ applications: apps });
}

export async function POST(req: Request) {
  const ctx = await mustAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { d } = ctx;
  const body = await req.json().catch(() => ({}));
  const { id, action, agreedPrice } = body as { id: string; action: string; agreedPrice?: number };
  const app = d.applications.find((a) => a.id === id);
  if (!app) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  const need = d.needs.find((n) => n.id === app.needId);

  if (action === "approve" || action === "reject") {
    app.status = action === "approve" ? "APPROVED" : "REJECTED";
    notify(
      app.applicantId,
      action === "approve" ? "✅" : "❌",
      action === "approve"
        ? "Your application was selected."
        : "Your application was not selected this time.",
      "/app/applications"
    );
    persist();
    return NextResponse.json({ ok: true, application: app });
  }

  if (action === "deal") {
    if (!need) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    const price = Number(agreedPrice ?? app.price);
    if (!price || price <= 0) {
      return NextResponse.json({ error: "Enter a valid agreed price." }, { status: 400 });
    }
    app.status = "APPROVED";
    const commission = Math.round(price * 0.08);
    const deal = {
      id: nextDealId(),
      needId: need.id,
      applicationId: app.id,
      buyerId: need.userId,
      sellerId: app.applicantId,
      title: need.title,
      agreedPrice: price,
      commission,
      finalAmount: price + commission,
      paymentStatus: "Pending" as const,
      deliveryStatus: "Pending" as const,
      status: "Negotiating" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    d.deals.unshift(deal);
    notify(need.userId, "🤝", `Deal ${deal.id} is now active.`, `/app/deals/${deal.id}`);
    notify(app.applicantId, "🤝", `Deal ${deal.id} is now active.`, `/app/deals/${deal.id}`);
    persist();
    return NextResponse.json({ ok: true, deal });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
