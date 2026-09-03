import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { findCryptoPayment, updateCryptoPayment } from "@/lib/crypto-payments";
import { getLicenseKeys, saveLicenseKeys, generateKeyCode, getSubscriptions, saveSubscriptions } from "@/lib/subscriptions";
import { PLANS } from "@/lib/plans";
import { isPaidStatus, fetchNowPaymentsStatus } from "@/lib/nowpayments";

function getUserId(req: NextRequest): string | null {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

function isAdminEmail(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS || "";
  if (!raw.trim()) return true; // if not set, allow owner to confirm own payments
  const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

function getUserEmail(req: NextRequest): string {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return String((p as any)?.email || "");
}

function doActivate(order: any, status: string, payCurrency?: string) {
  if (order.licenseKey) return { already: true, code: order.licenseKey };
  const plan = (PLANS as any)[order.planId];
  if (!plan) throw new Error("Invalid plan on order");
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
    note: `Crypto auto-activated — ${payCurrency || order.payCurrency || "crypto"} — order ${order.orderId} — ${status}`,
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
  updateCryptoPayment(order.orderId, { licenseKey: code, licenseKeyId: k.id, status: status as any });
  console.log(`[crypto confirm] ✅ Activated ${code} + ${sub.id} for ${order.orderId}`);
  return { already: false, code, subId: sub.id, expiresAt };
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || body.order_id || "").trim();
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

  const order = findCryptoPayment(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const email = getUserEmail(req);
  const isAdmin = isAdminEmail(email);
  const isOwner = order.userId === userId;

  // Owner can verify, admin can force-confirm any order
  if (!isOwner && !isAdmin) return NextResponse.json({ error: "Not your order" }, { status: 403 });
  if (order.licenseKey) return NextResponse.json({ ok: true, already: true, licenseKey: order.licenseKey, message: "Already activated" });

  // 1) Try to verify directly with NOWPayments first (if we have paymentId, this works with x-api-key)
  let verifiedStatus: string | null = null;
  let payCurrency: string | undefined;
  try {
    const fetched = await fetchNowPaymentsStatus({
      orderId: order.orderId,
      invoiceId: order.invoiceId || undefined,
      paymentId: order.paymentId || undefined,
    });
    if (fetched && fetched.status) {
      verifiedStatus = fetched.status;
      payCurrency = fetched.payCurrency;
      if (fetched.paymentId) updateCryptoPayment(orderId, { paymentId: fetched.paymentId, payCurrency: fetched.payCurrency || order.payCurrency });
      if (fetched.status && fetched.status !== order.status) updateCryptoPayment(orderId, { status: fetched.status as any });
      if (isPaidStatus(fetched.status)) {
        const result = doActivate(findCryptoPayment(orderId) || order, fetched.status, fetched.payCurrency);
        const updated = findCryptoPayment(orderId);
        return NextResponse.json({ ok: true, verified: true, status: fetched.status, payment: updated, licenseKey: (result as any).code, message: `Payment verified (${fetched.status}) — API key generated & plan activated!` });
      }
      // Not paid yet
      const updated = findCryptoPayment(orderId);
      return NextResponse.json({ ok: true, verified: true, status: fetched.status, payment: updated, message: `Payment status: ${fetched.status} — not yet confirmed on blockchain. Try again in a minute.` });
    }
  } catch (e: any) {
    console.warn("[crypto confirm] verify failed", e.message);
  }

  // 2) If NOWPayments verification returned nothing (common on localhost with x-api-key only),
  //    we cannot auto-verify. For localhost/dev, allow owner to force-activate for testing
  //    if they explicitly pass force=true, or if admin confirms.
  const force = body.force === true || body.force === "true";
  const isLocalhost = (process.env.NEXT_PUBLIC_APP_URL || "").includes("localhost") || (process.env.NODE_ENV !== "production");

  if (force) {
    // Only allow force on localhost/dev OR by admin in production
    if (!isLocalhost && !isAdmin) {
      return NextResponse.json({ error: "Force confirm only allowed on localhost or by admin. Contact support @princerana with your Order ID." }, { status: 403 });
    }
    const result = doActivate(findCryptoPayment(orderId) || order, "finished", payCurrency);
    const updated = findCryptoPayment(orderId);
    return NextResponse.json({ ok: true, forced: true, payment: updated, licenseKey: (result as any).code, message: `✅ (Test) Payment force-confirmed — API key: ${(result as any).code} — plan activated!` });
  }

  // 3) Could not verify automatically — tell user what to do
  return NextResponse.json({
    ok: false,
    verified: false,
    status: order.status,
    payment: order,
    message: verifiedStatus ? `Status: ${verifiedStatus} — not yet paid` : "Could not verify automatically (localhost cannot receive NOWPayments webhooks). If you have paid, click Verify again or contact support @princerana with Order ID: " + orderId,
    hint: isLocalhost ? "On localhost, NOWPayments cannot call your webhook. Use Force Confirm for testing, or deploy to a public URL and set NEXT_PUBLIC_APP_URL." : "Webhook will auto-activate when NOWPayments confirms. If stuck, contact @princerana.",
    canForce: isLocalhost || isAdmin,
  }, { status: 202 });
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: true, message: "POST { orderId, force?: boolean } to verify/confirm crypto payment. Force only on localhost or by admin." });
}
