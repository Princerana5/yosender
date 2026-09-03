import { NextRequest, NextResponse } from "next/server";
import { verifyIpnSignature } from "@/lib/nowpayments";
import { findCryptoPayment, updateCryptoPayment } from "@/lib/crypto-payments";
import { getLicenseKeys, saveLicenseKeys, generateKeyCode, getSubscriptions, saveSubscriptions } from "@/lib/subscriptions";
import { PLANS } from "@/lib/plans";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: any = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }

  const sig = req.headers.get("x-nowpayments-sig") || req.headers.get("x-nowpayments-signature") || req.headers.get("x-signature");
  const ok = verifyIpnSignature(rawBody, sig);
  if (!ok) {
    console.warn("[crypto webhook] Invalid IPN signature", { sig: sig?.slice(0, 20), body: JSON.stringify(body).slice(0, 300) });
    const hasSecret = !!process.env.NOWPAYMENTS_IPN_SECRET;
    if (hasSecret) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const orderId = String(body.order_id || body.orderId || body.orderID || "");
  const paymentStatus = String(body.payment_status || body.paymentStatus || body.status || "").toLowerCase();
  const paymentId = body.payment_id || body.paymentId || null;
  const invoiceId = body.invoice_id || body.invoiceId || null;

  if (!orderId) {
    console.warn("[crypto webhook] No order_id in IPN", JSON.stringify(body).slice(0, 500));
    return NextResponse.json({ ok: true, note: "No order_id — ignored" });
  }

  const existing = findCryptoPayment(orderId);
  if (!existing) {
    console.warn("[crypto webhook] Unknown order_id", orderId);
    return NextResponse.json({ ok: true, note: "Unknown order" });
  }

  const statusMap: Record<string, string> = {
    waiting: "waiting",
    confirming: "confirming",
    confirmed: "confirmed",
    sending: "sending",
    partially_paid: "partially_paid",
    finished: "finished",
    failed: "failed",
    refunded: "refunded",
    expired: "expired",
  };
  const newStatus = (statusMap[paymentStatus] || paymentStatus || existing.status) as any;

  const patch: any = { status: newStatus, raw: body, updatedAt: new Date().toISOString() };
  if (paymentId) patch.paymentId = String(paymentId);
  if (invoiceId) patch.invoiceId = String(invoiceId);
  if (body.pay_currency) patch.payCurrency = String(body.pay_currency);
  updateCryptoPayment(orderId, patch);

  const isPaid = paymentStatus === "finished" || paymentStatus === "confirmed";
  if (isPaid) {
    const updated = findCryptoPayment(orderId);
    if (updated && !updated.licenseKey) {
      const plan = (PLANS as any)[updated.planId];
      if (plan) {
        const code = generateKeyCode(updated.planId as any, updated.billing as any);
        const now = new Date();
        const days = updated.billing === "daily" ? 1 : 30;
        const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

        // 1) Create license key already marked as USED by this user (this IS the API key)
        const keys = getLicenseKeys();
        const k: any = {
          id: `key_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          code,
          planId: updated.planId,
          billing: updated.billing,
          status: "used",
          createdAt: now.toISOString(),
          usedBy: updated.userId,
          usedAt: now.toISOString(),
          note: `Crypto auto-activated — ${updated.payCurrency || "crypto"} — order ${orderId} — ${paymentStatus}`,
        };
        keys.unshift(k);
        saveLicenseKeys(keys);

        // 2) Auto-create / activate subscription — no manual redeem needed
        const subs = getSubscriptions();
        // expire any existing active for this user? keep them, newest wins via getActiveSubscription
        const sub: any = {
          id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          userId: updated.userId,
          planId: updated.planId,
          billing: updated.billing,
          keyId: k.id,
          keyCode: code,
          activatedAt: now.toISOString(),
          expiresAt,
          status: "active",
        };
        subs.unshift(sub);
        saveSubscriptions(subs);

        updateCryptoPayment(orderId, { licenseKey: code, licenseKeyId: k.id });
        console.log(`[crypto webhook] ✅ Auto-activated ${code} + subscription ${sub.id} for user ${updated.userId} order ${orderId} (${updated.planId} ${updated.billing}) till ${expiresAt}`);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "NOWPayments webhook — POST IPN here. Set NOWPAYMENTS_IPN_SECRET and NEXT_PUBLIC_APP_URL in .env.local" });
}
