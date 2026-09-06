import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getRentalPool } from "@/lib/db";
import { createNowPaymentsInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { upsertCryptoPayment } from "@/lib/crypto-payments";

function getUser(req: NextRequest): { id: string; email: string } | null {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? (verifyToken(t) as any) : null;
  if (!p?.id) return null;
  return { id: p.id, email: String(p.email || "") };
}

// POST /api/rentals/checkout — { poolAccountId } → creates NOWPayments invoice for $pricePerDay, order tagged as rental
export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  if (!isNowPaymentsConfigured())
    return NextResponse.json({ error: "Crypto payments not configured — set NOWPAYMENTS_API_KEY in .env.local" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const poolAccountId = String(body.poolAccountId || body.id || "").trim();
  if (!poolAccountId) return NextResponse.json({ error: "poolAccountId required" }, { status: 400 });

  const pool = getRentalPool();
  const p = pool.find((x) => x.id === poolAccountId);
  if (!p) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (p.status !== "available") return NextResponse.json({ error: "Already rented — try another" }, { status: 409 });

  const priceAmount = Number(p.pricePerDay) || 1;
  const payCurrency = body.payCurrency ? String(body.payCurrency).trim().toLowerCase() : undefined;
  const orderId = `rent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host") || "localhost:3000"}`;
  const successUrl = `${origin}/?crypto=success&order=${orderId}&rent=1`;
  const cancelUrl = `${origin}/?crypto=cancel&order=${orderId}&rent=1`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin;
  const ipnCallbackUrl = `${appUrl}/api/payments/crypto/webhook`;

  try {
    const { invoiceUrl, invoiceId, raw } = await createNowPaymentsInvoice({
      priceAmount,
      priceCurrency: "usd",
      payCurrency,
      orderId,
      orderDescription: `Rent sender ${p.displayName} (@${p.username}) — 24h — Yosender`,
      successUrl,
      cancelUrl,
      ipnCallbackUrl,
    });

    const now = new Date().toISOString();
    upsertCryptoPayment({
      id: orderId,
      orderId,
      invoiceId,
      paymentId: null,
      userId: user.id,
      userEmail: user.email,
      // tag as rental: planId carries "rental:<poolAccountId>" so webhook/confirm can fulfill the rental
      planId: `rental:${p.id}` as any,
      billing: "daily",
      amountUsd: priceAmount,
      payCurrency: payCurrency || null,
      priceCurrency: "usd",
      status: "waiting",
      invoiceUrl,
      licenseKey: null,
      licenseKeyId: null,
      createdAt: now,
      updatedAt: now,
      raw: { ...raw, kind: "rental", poolAccountId: p.id },
    });

    return NextResponse.json({ ok: true, orderId, invoiceUrl, invoiceId, amountUsd: priceAmount, poolAccountId: p.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to create crypto invoice" }, { status: 500 });
  }
}
