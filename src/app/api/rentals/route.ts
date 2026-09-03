import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getRentalPool, saveRentalPool, getRentals, saveRentals, getAccounts, saveAccounts, ensureRentalPoolSeed } from "@/lib/db";
import { getActiveSubscription, freeRentUsedToday } from "@/lib/subscriptions";
import { getPlan } from "@/lib/plans";

function uid(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

function expireRentals() {
  const now = Date.now();
  let changed = false;
  const rentals = getRentals();
  const pool = getRentalPool();
  const accounts = getAccounts();
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
}

export async function GET(req: NextRequest) {
  ensureRentalPoolSeed();
  expireRentals();
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const pool = getRentalPool();
  const rentals = getRentals().filter((r) => r.userId === id).sort((a, b) => b.rentedAt.localeCompare(a.rentedAt));
  const myActive = rentals.filter((r) => r.status === "active");
  const sub = getActiveSubscription(id);
  const plan = sub ? getPlan(sub.planId) : null;
  const freeUsed = freeRentUsedToday(id);
  const freeLeft = plan ? Math.max(0, plan.freeRentPerDay - freeUsed) : 0;
  const poolView = pool.map((p) => ({
    id: p.id, phone: p.phone, username: p.username, displayName: p.displayName, firstName: p.firstName, status: p.status, pricePerDay: p.pricePerDay,
    isMine: myActive.some((r) => r.poolAccountId === p.id),
  }));
  const available = pool.filter((p) => p.status === "available").length;
  return NextResponse.json({ pool: poolView, rentals, myActive, available, total: pool.length, plan, subscription: sub, freeUsed, freeLeft });
}

export async function POST(req: NextRequest) {
  ensureRentalPoolSeed();
  expireRentals();
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const poolAccountId = String(body.poolAccountId || body.id || "");
  const useFree = !!body.useFree;
  if (!poolAccountId) return NextResponse.json({ error: "poolAccountId required" }, { status: 400 });

  const pool = getRentalPool();
  const p = pool.find((x) => x.id === poolAccountId);
  if (!p) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (p.status !== "available") return NextResponse.json({ error: "Already rented — try another" }, { status: 409 });

  const rentals = getRentals();
  if (rentals.some((r) => r.userId === id && r.poolAccountId === p.id && r.status === "active")) {
    return NextResponse.json({ error: "You already rented this account" }, { status: 409 });
  }

  // free rent logic
  let isFree = false;
  let price = p.pricePerDay;
  if (useFree) {
    const sub = getActiveSubscription(id);
    const plan = sub ? getPlan(sub.planId) : null;
    if (!plan) return NextResponse.json({ error: "No active plan — free rent requires a subscription" }, { status: 403 });
    if (plan.freeRentPerDay <= 0) return NextResponse.json({ error: `${plan.name} has no free rented accounts. Upgrade for free rentals.` }, { status: 403 });
    const used = freeRentUsedToday(id);
    if (used >= plan.freeRentPerDay) return NextResponse.json({ error: `Free limit reached — ${plan.freeRentPerDay}/day used. Try tomorrow or pay.` }, { status: 429 });
    isFree = true; price = 0;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rentedAt = now.toISOString();
  p.status = "rented"; p.rentedBy = id; p.rentedAt = rentedAt; p.expiresAt = expiresAt;
  saveRentalPool(pool);

  const accounts = getAccounts();
  const tgAccountId = `rent_${p.id}_${Date.now().toString(36)}`;
  const tgAcc: any = {
    id: tgAccountId, userId: id, phone: p.phone, username: p.username, displayName: p.displayName + " · Rented", firstName: p.firstName,
    session: p.session || `__RENTAL_MOCK__${p.id}`, status: "connected", createdAt: rentedAt, isRental: true, rentalId: "", rentalExpiresAt: expiresAt, rentalPoolId: p.id,
  };
  accounts.push(tgAcc); saveAccounts(accounts);
  const rental: any = {
    id: `rental_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, userId: id, poolAccountId: p.id, tgAccountId, phone: p.phone, username: p.username, displayName: p.displayName, firstName: p.firstName,
    price, rentedAt, expiresAt, status: "active", isFree,
  };
  tgAcc.rentalId = rental.id; saveAccounts(accounts);
  rentals.unshift(rental); saveRentals(rentals);
  const res = NextResponse.json({ ok: true, rental, tgAccountId, expiresAt, isFree, message: isFree ? "Free rented account added — 24h" : "Rented for 24 hours — account added to your senders" });
  res.cookies.set("tg_active_id", tgAccountId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  if (p.session) res.cookies.set("tg_session", p.session, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
