import { NextRequest, NextResponse } from "next/server";
import { getAccounts } from "@/lib/db";
import { getUserIdFromReq, getActiveId, MAX_TG_ACCOUNTS } from "@/lib/tg-accounts";

export async function GET(req: NextRequest) {
  const uid = getUserIdFromReq(req);
  if (!uid) return NextResponse.json({ error: "Login required" }, { status: 401 });
  // Lazy rental expiry: an expired rental's tg row must disappear from the
  // list even if nobody hits /api/rentals — expiry is time-based, not
  // logout-based, so rentals survive logout until their 24h window ends.
  // The tg row is deleted too (auto-logout from that user's senders) and the
  // pool account returns to available for the next renter.
  try {
    const { getRentals, saveRentals, getRentalPool, saveRentalPool, getAccounts, saveAccounts } = await import("@/lib/db");
    const now = Date.now();
    const rentals = getRentals();
    const pool = getRentalPool();
    const accounts = getAccounts();
    let touched = false;
    for (const r of rentals) {
      if (r.status === "active" && new Date(r.expiresAt).getTime() <= now) {
        r.status = "expired"; touched = true;
        const p = pool.find((x) => x.id === r.poolAccountId);
        if (p && p.status === "rented" && p.rentedBy === r.userId) { p.status = "available"; p.rentedBy = null; p.rentedAt = null; p.expiresAt = null; }
        const idx = accounts.findIndex((a) => a.id === r.tgAccountId);
        if (idx !== -1) accounts.splice(idx, 1);
      }
    }
    if (touched) { saveRentals(rentals); saveRentalPool(pool); saveAccounts(accounts); }
  } catch {}
  const all = getAccounts().filter((a) => a.userId === uid);
  // Legacy tg_session auto-migration REMOVED: it resurrected explicitly
  // deleted/logged-out accounts from a stale cookie ("deleted but still
  // shows"). The DB is the only source of truth — no rows, no accounts.
  // Any stale tg_session cookie is cleared so it can't revive anything.
  const activeId = getActiveId(req);
  const safe = all.map(({ session, ...rest }) => rest);
  const res = NextResponse.json({ accounts: safe, activeId: activeId || (all[0]?.id ?? null), max: MAX_TG_ACCOUNTS });
  // Kill any stale tg_session cookie: with auto-migration gone, a leftover
  // cookie would otherwise keep /telegram/me reporting a deleted account as
  // connected (sidebar ghost) even with zero rows in the DB.
  if (!all.length) {
    res.cookies.set("tg_session", "", { maxAge: 0, path: "/" });
    res.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
  }
  return res;
}

export async function POST(req: NextRequest) {
  const uid = getUserIdFromReq(req);
  if (!uid) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { accountId } = await req.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });
  const all = getAccounts();
  const acc = all.find((a) => a.id === String(accountId) && a.userId === uid);
  if (!acc) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  // Verify session still valid (best effort)
  try {
    const c = getClient(acc.session);
    await c.connect();
    await c.getMe();
    await c.disconnect();
  } catch {
    // still allow switching even if Telegram check fails — don't block
  }
  const res = NextResponse.json({ ok: true, activeId: acc.id });
  res.cookies.set("tg_active_id", acc.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  // Keep legacy cookie in sync so old code paths work
  res.cookies.set("tg_session", acc.session, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}

export async function DELETE(req: NextRequest) {
  const uid = getUserIdFromReq(req);
  if (!uid) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const all = getAccounts();
  const target = all.find((a) => a.id === String(id) && a.userId === uid);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Active rentals can only be HIDDEN client-side (X button hides them for this
  // session). The server row + pool hold stay until the 24h expiry — deleting
  // here would hand the pool account to someone else mid-rental.
  if ((target as any).isRental) {
    return NextResponse.json({ error: "Rented senders stay till expiry — they auto-remove after 24h", hideOnly: true }, { status: 409 });
  }
  const idx = all.findIndex((a) => a.id === String(id) && a.userId === uid);
  all.splice(idx, 1);
  saveAccounts(all);
  const remaining = all.filter((a) => a.userId === uid);
  const activeId = getActiveId(req);
  const res = NextResponse.json({ ok: true, activeId: remaining[0]?.id ?? null });
  if (activeId === String(id)) {
    if (remaining[0]) {
      res.cookies.set("tg_active_id", remaining[0].id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
      res.cookies.set("tg_session", remaining[0].session, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    } else {
      res.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
      res.cookies.set("tg_session", "", { maxAge: 0, path: "/" });
    }
  }
  return res;
}
