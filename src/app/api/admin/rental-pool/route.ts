import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { getRentalPool, saveRentalPool, getRentals, getAccounts, saveAccounts, getUsers } from "@/lib/db";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "rentals")) return NextResponse.json({ error: "No permission: rentals" }, { status: 403 });
  const pool = getRentalPool();
  const rentals = getRentals();

  const enriched = pool.map(p => {
    const activeRental = rentals.find(r => r.poolAccountId === p.id && r.status === "active");
    const rentedByUser = activeRental ? activeRental.userId : null;
    const user = getAccounts().find(a => a.userId === rentedByUser);
    return {
      ...p,
      rentedBy: rentedByUser,
      rentedByEmail: user ? (getUsers().find(u => u.id === rentedByUser) as any)?.email : null,
      expiresAt: p.expiresAt || null,
      createdAt: p.createdAt,
    };
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ pool: enriched });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "rentals")) return NextResponse.json({ error: "No permission: rentals" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone || "");
  const username = String(body.username || "");
  const displayName = String(body.displayName || "");
  const firstName = String(body.firstName || "");
  const session = String(body.session || "");
  const pricePerDay = Number(body.pricePerDay) || 1;

  if (!phone || !username || !displayName) return NextResponse.json({ error: "phone, username, displayName required" }, { status: 400 });

  const pool = getRentalPool();
  const id = `rent_pool_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const acc = {
    id, phone, username, displayName, firstName, session,
    status: "available" as const,
    pricePerDay,
    createdAt: now,
    rentedBy: null, rentedAt: null, expiresAt: null,
  };
  pool.unshift(acc);
  saveRentalPool(pool);
  return NextResponse.json({ ok: true, account: acc });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "rentals")) return NextResponse.json({ error: "No permission: rentals" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "");
  const pool = getRentalPool();
  const idx = pool.findIndex(p => p.id === id);
  if (idx === -1) return NextResponse.json({ error: "Pool account not found" }, { status: 404 });

  if (action === "ban") {
    pool[idx].status = "banned";
    pool[idx].rentedBy = null;
    pool[idx].rentedAt = null;
    pool[idx].expiresAt = null;
    const rentals = getRentals();
    for (const r of rentals) {
      if (r.poolAccountId === id && r.status === "active") {
        r.status = "expired";
      }
    }
    const { saveRentals } = await import("@/lib/db");
    saveRentals(rentals);
    const accounts = getAccounts();
    const accIdx = accounts.findIndex(a => a.rentalPoolId === id && a.isRental);
    if (accIdx !== -1) accounts.splice(accIdx, 1);
    saveAccounts(accounts);
    saveRentalPool(pool);
    return NextResponse.json({ ok: true, account: pool[idx] });
  }
  if (action === "unban") {
    if (pool[idx].status === "banned") pool[idx].status = "available";
    saveRentalPool(pool);
    return NextResponse.json({ ok: true, account: pool[idx] });
  }
  if (action === "update") {
    if (body.pricePerDay != null) pool[idx].pricePerDay = Number(body.pricePerDay);
    if (body.username) pool[idx].username = body.username;
    if (body.displayName) pool[idx].displayName = body.displayName;
    if (body.firstName) pool[idx].firstName = body.firstName;
    if (body.session) pool[idx].session = body.session;
    if (body.phone) pool[idx].phone = body.phone;
    saveRentalPool(pool);
    return NextResponse.json({ ok: true, account: pool[idx] });
  }
  if (action === "force_free") {
    if (pool[idx].status === "rented") {
      pool[idx].status = "available";
      pool[idx].rentedBy = null;
      pool[idx].rentedAt = null;
      pool[idx].expiresAt = null;
      const rentals = getRentals();
      for (const r of rentals) {
        if (r.poolAccountId === id && r.status === "active") r.status = "expired";
      }
      const { saveRentals } = await import("@/lib/db");
      saveRentals(rentals);
      const accounts = getAccounts();
      const accIdx = accounts.findIndex(a => a.rentalPoolId === id && a.isRental);
      if (accIdx !== -1) accounts.splice(accIdx, 1);
      saveAccounts(accounts);
      saveRentalPool(pool);
    }
    return NextResponse.json({ ok: true, account: pool[idx] });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "rentals")) return NextResponse.json({ error: "No permission: rentals" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const pool = getRentalPool();
  const idx = pool.findIndex(p => p.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pool[idx].status === "rented") return NextResponse.json({ error: "Cannot delete rented account — force_free first" }, { status: 409 });
  pool.splice(idx, 1);
  saveRentalPool(pool);
  return NextResponse.json({ ok: true });
}
