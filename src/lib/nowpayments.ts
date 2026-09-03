const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";

function getApiKey(): string {
  return process.env.NOWPAYMENTS_API_KEY || "";
}

function getIpnSecret(): string {
  return process.env.NOWPAYMENTS_IPN_SECRET || "";
}

export function isNowPaymentsConfigured(): boolean {
  return !!getApiKey();
}

export async function createNowPaymentsInvoice(params: {
  priceAmount: number;
  priceCurrency?: string;
  payCurrency?: string;
  orderId: string;
  orderDescription: string;
  successUrl?: string;
  cancelUrl?: string;
  ipnCallbackUrl?: string;
}): Promise<{ invoiceUrl: string; invoiceId: string; raw: any }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not set in .env.local");

  const body: any = {
    price_amount: params.priceAmount,
    price_currency: params.priceCurrency || "usd",
    order_id: params.orderId,
    order_description: params.orderDescription,
    ipn_callback_url: params.ipnCallbackUrl || undefined,
    success_url: params.successUrl || undefined,
    cancel_url: params.cancelUrl || undefined,
  };
  if (params.payCurrency) body.pay_currency = params.payCurrency;

  const r = await fetch(`${NOWPAYMENTS_API}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `NOWPayments invoice failed: ${r.status} ${JSON.stringify(j).slice(0, 500)}`);
  const invoiceUrl = j.invoice_url || j.invoiceUrl || j.url;
  const invoiceId = String(j.id || j.invoice_id || j.invoiceId || "");
  if (!invoiceUrl) throw new Error(`NOWPayments: no invoice_url in response: ${JSON.stringify(j).slice(0, 500)}`);
  return { invoiceUrl, invoiceId, raw: j };
}

export function verifyIpnSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = getIpnSecret();
  if (!secret) return true;
  if (!signatureHeader) return false;
  try {
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    return hmac === signatureHeader || hmac.toLowerCase() === signatureHeader.toLowerCase();
  } catch {
    return false;
  }
}

export function getPlanPriceUsd(planId: string, billing: "daily" | "monthly"): number {
  const prices: Record<string, Record<string, number>> = {
    elite: { daily: 2, monthly: 55 },
    pro: { daily: 5, monthly: 150 },
    max_plus: { daily: 12, monthly: 299 },
    luxe: { daily: 0, monthly: 1300 },
  };
  return prices[planId]?.[billing] ?? 0;
}

// ── Direct verification with NOWPayments ──
// NOTE: NOWPayments payment-status API requires JWT (email/password), not just x-api-key.
// Invoice x-api-key can CREATE invoices but cannot LIST payments. So this will return null
// on localhost and we fall back to IPN webhook (which needs a public URL) or manual admin confirm.
export async function fetchNowPaymentsStatus(params: {
  orderId?: string;
  invoiceId?: string;
  paymentId?: string;
}): Promise<{ status: string; payCurrency?: string; paymentId?: string; raw: any } | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const headers: Record<string, string> = { "x-api-key": apiKey };
  const pickStatus = (obj: any): string => String(obj.payment_status || obj.paymentStatus || obj.status || "").toLowerCase();

  // Only paymentId lookup works with x-api-key (if we have it from IPN)
  if (params.paymentId) {
    try {
      const r = await fetch(`${NOWPAYMENTS_API}/payment/${params.paymentId}`, { headers });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.payment_id) {
        return { status: pickStatus(j), payCurrency: j.pay_currency || j.payCurrency, paymentId: String(j.payment_id), raw: j };
      }
    } catch {}
  }

  // Invoice/payment list endpoints require JWT — will 401 with x-api-key, so we return null
  // and let the caller handle it (manual confirm or IPN).
  return null;
}

export function isPaidStatus(s: string): boolean {
  const v = String(s || "").toLowerCase();
  return v === "finished" || v === "confirmed";
}

// ── Auto-activate helper — generates API key + subscription ──
export function activateOrderPayment(order: any, paymentStatus: string, payCurrency?: string): { code: string; subId: string } | null {
  const { getLicenseKeys, saveLicenseKeys, generateKeyCode, getSubscriptions, saveSubscriptions } = require("./subscriptions");
  const { PLANS } = require("./plans");
  const plan = (PLANS as any)[order.planId];
  if (!plan) return null;
  if (order.licenseKey) return { code: order.licenseKey, subId: order.licenseKeyId || "" };

  const code = generateKeyCode(order.planId as any, order.billing as any);
  const now = new Date();
  const days = order.billing === "daily" ? 1 : 30;
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const keys = getLicenseKeys();
  const k: any = {
    id: `key_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    code,
    planId: order.planId,
    billing: order.billing,
    status: "used",
    createdAt: now.toISOString(),
    usedBy: order.userId,
    usedAt: now.toISOString(),
    note: `Crypto auto-activated — ${payCurrency || order.payCurrency || "crypto"} — order ${order.orderId} — ${paymentStatus}`,
  };
  keys.unshift(k);
  saveLicenseKeys(keys);

  const subs = getSubscriptions();
  const sub: any = {
    id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    userId: order.userId,
    planId: order.planId,
    billing: order.billing,
    keyId: k.id,
    keyCode: code,
    activatedAt: now.toISOString(),
    expiresAt,
    status: "active",
  };
  subs.unshift(sub);
  saveSubscriptions(subs);

  const { updateCryptoPayment } = require("./crypto-payments");
  updateCryptoPayment(order.orderId, { licenseKey: code, licenseKeyId: k.id, status: paymentStatus as any });

  console.log(`[nowpayments] ✅ Auto-activated ${code} + ${sub.id} for ${order.orderId} (${paymentStatus})`);
  return { code, subId: sub.id };
}
