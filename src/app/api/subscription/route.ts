import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getActiveSubscription, campaignsTodayCount, freeRentUsedToday } from "@/lib/subscriptions";
import { getPlan } from "@/lib/plans";

function uid(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

export async function GET(req: NextRequest) {
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  // Aggressive rental expiry on every subscription check — guarantees
  // pool accounts and tg rows are cleaned up before free-rent counters
  // are computed, so "used today" never counts stale expired rows.
  try {
    const { getRentals, saveRentals, getRentalPool, saveRentalPool, getAccounts, saveAccounts } = await import("@/lib/db");
    const now = Date.now();
    const rentals = getRentals();
    const pool = getRentalPool();
    const accounts = getAccounts();
    let changed = false;
    for (const r of rentals) {
      if (r.status === "active" && new Date(r.expiresAt).getTime() <= now) {
        r.status = "expired"; changed = true;
        const p = pool.find((x) => x.id === r.poolAccountId);
        if (p && p.status === "rented" && p.rentedBy === r.userId) { p.status = "available"; p.rentedBy = null; p.rentedAt = null; p.expiresAt = null; }
        const idx = accounts.findIndex((a) => a.id === r.tgAccountId);
        if (idx !== -1) accounts.splice(idx, 1);
      }
    }
    if (changed) { saveRentals(rentals); saveRentalPool(pool); saveAccounts(accounts); }
  } catch {}
  const sub = getActiveSubscription(id);
  const plan = sub ? getPlan(sub.planId) : null;
  const todayCount = campaignsTodayCount(id);
  const freeUsed = freeRentUsedToday(id);
  const freePerDay = plan ? plan.freeRentPerDay : 0;
  return NextResponse.json({
    subscription: sub,
    plan,
    usage: {
      campaignsToday: todayCount,
      campaignsLimit: plan ? (plan.campaignsPerDay === Infinity ? null : plan.campaignsPerDay) : null,
      freeRentUsedToday: freeUsed,
      freeRentPerDay: freePerDay,
      freeLeft: Math.max(0, freePerDay - freeUsed),
      freeUsed,
    },
  });
}
