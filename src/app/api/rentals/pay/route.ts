import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getRentalPool } from "@/lib/db";
import { getActiveSubscription, freeRentUsedToday } from "@/lib/subscriptions";
import { getPlan } from "@/lib/plans";
import { fulfillRentalOrder } from "@/lib/rental-fulfill";

// POST /api/rentals/pay — free-claim path only ({ poolAccountId, useFree: true }).
// Paid rentals go through /api/rentals/checkout (NOWPayments) instead.
// Runs fully in-process: no self-fetch, so it can never return an empty body.
export async function POST(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  const userId = (p as any)?.id || null;
  if (!userId) return NextResponse.json({ error: "Login required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const poolAccountId = String(body.poolAccountId || "");
  const useFree = !!body.useFree;
  if (!poolAccountId) return NextResponse.json({ error: "poolAccountId required" }, { status: 400 });
  if (!useFree) {
    return NextResponse.json(
      { error: "Paid rent uses crypto checkout — click Pay & Rent to create an invoice." },
      { status: 400 },
    );
  }

  // Free-claim quota checks (same rules as before — error messages unchanged).
  // Exclusive claim: pool row AND live rental records must both agree this
  // sender is free — never double-assign one sender to 2 users.
  const pool = getRentalPool();
  const pAcc = pool.find((x) => x.id === poolAccountId);
  if (!pAcc) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  try {
    const { getRentals } = await import("@/lib/db");
    const holder = (getRentals() as any[]).find((r: any) => r.poolAccountId === pAcc.id && r.status === "active");
    if (pAcc.status !== "available" || (holder && holder.userId !== userId)) {
      return NextResponse.json({ error: "Already rented — try another" }, { status: 409 });
    }
  } catch {
    if (pAcc.status !== "available") return NextResponse.json({ error: "Already rented — try another" }, { status: 409 });
  }
  const sub = getActiveSubscription(userId);
  const plan = sub ? getPlan(sub.planId) : null;
  if (!plan) return NextResponse.json({ error: "No active plan — free rent requires a subscription" }, { status: 403 });
  if (plan.freeRentPerDay <= 0)
    return NextResponse.json({ error: `${plan.name} has no free rented accounts. Upgrade for free rentals.` }, { status: 403 });
  const used = freeRentUsedToday(userId);
  if (used >= plan.freeRentPerDay)
    return NextResponse.json({ error: `Free limit reached — ${plan.freeRentPerDay}/day used. Try tomorrow or pay.` }, { status: 429 });

  try {
    const { rental, tgAccountId, already } = fulfillRentalOrder({
      orderId: `free_${userId}_${poolAccountId}_${new Date().toISOString().slice(0, 10)}`,
      userId,
      poolAccountId,
      price: 0,
      isFree: true,
    });
    const res = NextResponse.json({
      ok: true,
      rental,
      tgAccountId,
      expiresAt: (rental as any).expiresAt,
      isFree: true,
      already: !!already,
      message: "Free rented account added — 24h",
    });
    res.cookies.set("tg_active_id", tgAccountId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    if (pAcc.session)
      res.cookies.set("tg_session", pAcc.session, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Rent failed" }, { status: 409 });
  }
}
