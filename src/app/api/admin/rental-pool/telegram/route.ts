import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { pending, tgClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getRentalPool, saveRentalPool } from "@/lib/db";

// POST { phone, code, password?, phoneCodeHash? } -> verifies Telegram and auto-adds to rental pool at $1/24h
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "rentals")) return NextResponse.json({ error: "No permission: rentals" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone || "").trim();
  const code = String(body.code || "").trim();
  const password = body.password ? String(body.password) : "";
  const phoneCodeHash = body.phoneCodeHash ? String(body.phoneCodeHash) : "";

  if (!phone || !code) return NextResponse.json({ error: "phone and code required" }, { status: 400 });

  const tp = phone.replace(/\s+/g, "");
  let hash = phoneCodeHash || pending.get(phone)?.phoneCodeHash || pending.get(tp)?.phoneCodeHash;
  if (!hash && pending.size === 1) hash = [...pending.values()][0].phoneCodeHash;
  if (!hash) return NextResponse.json({ error: "No code session found. Tap Send Verification Code again and verify within 30 seconds." }, { status: 400 });

  try {
    if (!tgClient.connected) await tgClient.connect();
    let need2FA = false;
    try {
      await tgClient.invoke(new Api.auth.SignIn({ phoneNumber: tp, phoneCodeHash: hash, phoneCode: code.replace(/\s+/g, "") }));
    } catch (e: any) {
      const m = e.errorMessage || e.message || String(e);
      if (m.includes("SESSION_PASSWORD_NEEDED")) {
        need2FA = true;
        if (!password) return NextResponse.json({ needPassword: true, message: "2FA password required — enter your Telegram cloud password" });
        try {
          const pwdInfo: any = await tgClient.invoke(new Api.account.GetPassword());
          const { computeCheck } = await import("telegram/Password");
          await tgClient.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwdInfo, password) }));
        } catch (pwdErr: any) {
          const pm = pwdErr.errorMessage || pwdErr.message || String(pwdErr);
          if (pm.includes("PASSWORD_HASH_INVALID") || pm.includes("PASSWORD_INVALID")) {
            return NextResponse.json({ error: "Wrong 2FA password — try again", needPassword: true }, { status: 400 });
          }
          return NextResponse.json({ error: pm }, { status: 500 });
        }
      } else if (m.includes("PHONE_CODE_EXPIRED")) {
        return NextResponse.json({ error: "Code expired — tap Send Code again and use the NEW code within 30 seconds" }, { status: 400 });
      } else if (m.includes("PHONE_CODE_INVALID")) {
        return NextResponse.json({ error: "Invalid code — make sure you use the latest code from Telegram (check Telegram app, not SMS)" }, { status: 400 });
      } else if (m.includes("PHONE_NUMBER_INVALID") || m.includes("PHONE_NUMBER_FLOOD")) {
        return NextResponse.json({ error: m }, { status: 400 });
      } else {
        return NextResponse.json({ error: m }, { status: 500 });
      }
    }

    const sessionString = (tgClient.session as any).save() as string;
    let me: any;
    try { me = await tgClient.getMe(); } catch { me = { username: tp, firstName: "" }; }
    pending.delete(phone);
    pending.delete(tp);

    const username = me.username || "";
    const firstName = me.firstName || "";
    const lastName = me.lastName || "";
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
