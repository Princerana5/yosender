import { NextRequest, NextResponse } from "next/server";
import { pending, tgClient } from "@/lib/tg";
import { Api } from "telegram/tl";
export async function POST(req: NextRequest) {
  try {
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body — send JSON {phone}" }, { status: 400 }); }
    const { phone } = body || {};
    if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
    if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) return NextResponse.json({ error: "Server misconfigured: TELEGRAM_API_ID / TELEGRAM_API_HASH missing. Check .env.local and restart." }, { status: 500 });
    const p = phone.trim().replace(/\s+/g, "");
    if (!tgClient.connected) await tgClient.connect();
    const res: any = await tgClient.invoke(new Api.auth.SendCode({ phoneNumber: p, apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH!, settings: new Api.CodeSettings({}) }));
    // Some layers return type with .phoneCodeHash, others wrap it
    const hash = res?.phoneCodeHash || res?.phone_code_hash;
    if (!hash) return NextResponse.json({ error: "Telegram didn't return phoneCodeHash. Result: " + JSON.stringify(res).slice(0, 500) }, { status: 500 });
    pending.set(p, { phoneCodeHash: hash, phone: p });
    pending.set(phone.trim(), { phoneCodeHash: hash, phone: p });
    return NextResponse.json({ phoneCodeHash: hash });
  } catch (e: any) {
    console.error("[send-code]", e);
    return NextResponse.json({ error: e?.errorMessage || e?.message || String(e) }, { status: 500 });
  }
}
