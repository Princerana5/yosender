import { NextRequest, NextResponse } from "next/server";
import { sendLoginCode } from "@/lib/tg-login";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body — send JSON {phone}" }, { status: 400 }); }
    const { phone } = body || {};
    if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
    const { phoneCodeHash, dcId } = await sendLoginCode(String(phone));
    return NextResponse.json({ phoneCodeHash, dcId });
  } catch (e: any) {
    console.error("[send-code]", e);
    return NextResponse.json({ error: e?.errorMessage || e?.message || String(e) }, { status: 500 });
  }
}
