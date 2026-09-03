import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { getSubscriptions, saveSubscriptions } from "@/lib/subscriptions";
import { getUsers } from "@/lib/db";
import { getPlan } from "@/lib/plans";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "subs")) return NextResponse.json({ error: "No permission: subs" }, { status: 403 });
  const subs = getSubscriptions().sort((a, b) => new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime());
  const users = getUsers();
  const enriched = subs.map(s => {
    const u = users.find(u => u.id === s.userId);
    const plan = getPlan(s.planId);
    return {
      ...s,
      userEmail: u?.email || "Unknown",
      userName: u?.name || "Unknown",
      planName: plan?.name || s.planId,
    };
  });
  return NextResponse.json({ subscriptions: enriched });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "subs")) return NextResponse.json({ error: "No permission: subs" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "");
  const subs = getSubscriptions();
  const idx = subs.findIndex(s => s.id === id);
  if (idx === -1) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  if (action === "revoke") {
    subs[idx].status = "revoked";
    saveSubscriptions(subs);
    return NextResponse.json({ ok: true, subscription: subs[idx] });
  }
  if (action === "extend") {
    const days = Number(body.days) || 30;
    const cur = new Date(subs[idx].expiresAt);
    cur.setDate(cur.getDate() + days);
    subs[idx].expiresAt = cur.toISOString();
    subs[idx].status = "active";
    saveSubscriptions(subs);
    return NextResponse.json({ ok: true, subscription: subs[idx] });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
