import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  if (!(p as any)?.id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const poolAccountId = String(body.poolAccountId || "");
  const useFree = !!body.useFree;
  if (!poolAccountId) return NextResponse.json({ error: "poolAccountId required" }, { status: 400 });
  const paymentId = `pay_mock_${Date.now().toString(36)}`;
  const orderId = `order_mock_${Date.now().toString(36)}`;
  const base = req.nextUrl.origin;
  const r = await fetch(`${base}/api/rentals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: req.headers.get("cookie") || "" },
    body: JSON.stringify({ poolAccountId, useFree }),
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: j.error || "Rent failed" }, { status: r.status });
  return NextResponse.json({ ok: true, paymentId, orderId, rental: j.rental, tgAccountId: j.tgAccountId, expiresAt: j.expiresAt, isFree: j.isFree });
}
