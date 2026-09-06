import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { verifyLoginCode } from "@/lib/tg-login";
import { getRentalPool, saveRentalPool } from "@/lib/db";

// POST { phone, code, password?, phoneCodeHash?, dcId? } -> verifies Telegram and auto-adds to rental pool at $1/24h
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "rentals")) return NextResponse.json({ error: "No permission: rentals" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone || "").trim();
  const code = String(body.code || "").trim();
  const password = body.password ? String(body.password) : "";
  const phoneCodeHash = body.phoneCodeHash ? String(body.phoneCodeHash) : "";
  const dcId = typeof body.dcId === "number" ? body.dcId : undefined;

  if (!phone || !code) return NextResponse.json({ error: "phone and code required" }, { status: 400 });

  const tp = phone.replace(/\s+/g, "");

  try {
    let profile;
    try {
      profile = await verifyLoginCode({ phone, code, password, phoneCodeHash, dcId });
    } catch (e: any) {
      if ((e as any)?.needPassword) {
        return NextResponse.json({ needPassword: true, message: "2FA password required — enter your Telegram cloud password" });
      }
      const m = e?.errorMessage || e?.message || String(e);
      const status = m.includes("expired") || m.includes("Invalid code") || m.includes("Wrong 2FA") ? 400 : 500;
      return NextResponse.json({ error: m }, { status });
    }

    const { session: sessionString, username, firstName, lastName } = profile;
    const displayName = [firstName, lastName].filter(Boolean).join(" ") || username || tp;

    const pool = getRentalPool();
    if (pool.some((p) => p.phone.replace(/\s+/g, "") === tp)) {
      return NextResponse.json({ error: "This phone is already in the rental pool" }, { status: 409 });
    }
    const id = `rent_pool_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const acc = {
      id, phone: tp, username, displayName, firstName, session: sessionString,
      status: "available" as const,
      pricePerDay: 1,
      createdAt: now,
      rentedBy: null, rentedAt: null, expiresAt: null,
    };
    pool.unshift(acc);
    saveRentalPool(pool);

    return NextResponse.json({ ok: true, account: { ...acc, session: undefined }, message: "Telegram account verified and auto-listed for $1 / 24h — buyers can now rent in 1 click" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.errorMessage || e?.message || String(e) }, { status: 500 });
  }
}
