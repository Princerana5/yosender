import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { PLANS, PlanId } from "@/lib/plans";
import { createNowPaymentsInvoice, getPlanPriceUsd, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { upsertCryptoPayment } from "@/lib/crypto-payments";

function getUserId(req: NextRequest): string | null {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}
function getUserEmail(req: NextRequest): string {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return String((p as any)?.email || "");
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Login required" }, { status: 401 });
  if (!isNowPaymentsConfigured()) return NextResponse.json({ error: "Crypto payments not configured — set NOWPAYMENTS_API_KEY in .env.local" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const planId = String(body.planId || "") as PlanId;
  const billing = String(body.billing || "monthly") as "daily" | "monthly";
  const payCurrency = body.payCurrency ? String(body.payCurrency).trim().toLowerCase() : undefined;

  if (!(PLANS as any)[planId]) return NextResponse.json({ error: "Invalid planId" }, { status: 400 });
  if (billing !== "daily" && billing !== "monthly") return NextResponse.json({ error: "billing must be daily|monthly" }, { status: 400 });
  if ((PLANS as any)[planId].id === "luxe" && billing === "daily") return NextResponse.json({ error: "Luxe is monthly only" }, { status: 400 });

  const priceAmount = getPlanPriceUsd(planId, billing);
  if (!priceAmount) return NextResponse.json({ error: "Invalid price for this plan/billing" }, { status: 400 });

  const plan = (PLANS as any)[planId];
  const orderId = `yosender_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host") || "localhost:3000"}`;
  const successUrl = `${origin}/?crypto=success&order=${orderId}`;
  const cancelUrl = `${origin}/?crypto=cancel&order=${orderId}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin;
  const ipnCallbackUrl = `${appUrl}/api/payments/crypto/webhook`;

  try {
    const { invoiceUrl, invoiceId, raw } = await createNowPaymentsInvoice({
      priceAmount,
      priceCurrency: "usd",
      payCurrency,
      orderId,
      orderDescription: `${plan.name} — ${billing === "daily" ? "Daily (24h)" : "Monthly (30 days)"} — Yosender`,
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
      userId,
      userEmail: getUserEmail(req),
      planId,
      billing,
      amountUsd: priceAmount,
      payCurrency: payCurrency || null,
      priceCurrency: "usd",
      status: "waiting",
      invoiceUrl,
      licenseKey: null,
      licenseKeyId: null,
      createdAt: now,
      updatedAt: now,
      raw,
    });

    return NextResponse.json({ ok: true, orderId, invoiceUrl, invoiceId, amountUsd: priceAmount, planId, billing });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to create crypto invoice" }, { status: 500 });
  }
}
