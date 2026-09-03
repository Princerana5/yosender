import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { findCryptoPayment, getCryptoPayments, updateCryptoPayment } from "@/lib/crypto-payments";
import { fetchNowPaymentsStatus, isPaidStatus } from "@/lib/nowpayments";
import { getLicenseKeys, saveLicenseKeys, generateKeyCode, getSubscriptions, saveSubscriptions } from "@/lib/subscriptions";
import { PLANS } from "@/lib/plans";

function getUserId(req: NextRequest): string | null {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

async function verifyAndAutoActivate(orderId: string) {
  const local = findCryptoPayment(orderId);
  if (!local) return null;
  // Already activated — nothing to do
  if (local.licenseKey) return local;

  let fetched: Awaited<ReturnType<typeof fetchNowPaymentsStatus>> = null;
  try {
    fetched = await fetchNowPaymentsStatus({
      orderId: local.orderId,
      invoiceId: local.invoiceId || undefined,
      paymentId: local.paymentId || undefined,
    });
  } catch (e) {
    console.warn("[crypto status] verify fetch failed", orderId, (e as any)?.message);
  }

  if (!fetched || !fetched.status) return local;

  const newStatus = fetched.status as any;
  const patch: any = {};
  if (newStatus && newStatus !== local.status) patch.status = newStatus;
  if (fetched.payCurrency) patch.payCurrency = String(fetched.payCurrency);
  if (fetched.paymentId) patch.paymentId = String(fetched.paymentId);
  if (fetched.raw) patch.raw = fetched.raw;
  if (Object.keys(patch).length) {
    patch.updatedAt = new Date().toISOString();
    updateCryptoPayment(orderId, patch);
  }

  const updated = findCryptoPayment(orderId);
  if (!updated) return local;

  // Auto-generate API key + subscription if paid and not yet generated
  if (isPaidStatus(newStatus) && !updated.licenseKey) {
    const plan = (PLANS as any)[updated.planId];
    if (plan) {
      const code = generateKeyCode(updated.planId as any, updated.billing as any);
      const now = new Date();
      const days = updated.billing === "daily" ? 1 : 30;
      const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
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
        note: `Crypto auto-activated (status verify) — ${updated.payCurrency || fetched.payCurrency || "crypto"} — order ${orderId} — ${newStatus}`,
      };
      keys.unshift(k);
      saveLicenseKeys(keys);
      const subs = getSubscriptions();
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
      updateCryptoPayment(orderId, { licenseKey: code, licenseKeyId: k.id, status: newStatus as any });
      console.log(`[crypto status] ✅ Verified & auto-activated ${code} + ${sub.id} for ${orderId} (${newStatus})`);
      return findCryptoPayment(orderId);
    }
  }
  return findCryptoPayment(orderId) || updated;
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const url = new URL(req.url);
  const orderId = url.searchParams.get("orderId") || url.searchParams.get("order_id") || "";
  if (orderId) {
    const p = findCryptoPayment(orderId);
    if (!p) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (p.userId !== userId) return NextResponse.json({ error: "Not your order" }, { status: 403 });
    // Verify directly with NOWPayments on every poll — fixes localhost webhook never arriving
    const verified = await verifyAndAutoActivate(orderId);
    return NextResponse.json({ payment: verified || p });
  }
  // List — also verify WAITING ones in background (best-effort, don't block)
  const all = getCryptoPayments().filter(x => x.userId === userId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  // Verify waiting/confirming in parallel (fire and forget for list, but await for correctness)
  const waiting = all.filter(x => !x.licenseKey && ["waiting", "confirming", "sending"].includes(x.status));
  if (waiting.length) {
    await Promise.all(waiting.slice(0, 5).map(x => verifyAndAutoActivate(x.orderId).catch(() => null)));
    const refreshed = getCryptoPayments().filter(x => x.userId === userId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return NextResponse.json({ payments: refreshed });
  }
  return NextResponse.json({ payments: all });
}

export async function POST(req: NextRequest) {
  // Manual verify trigger — same as GET but explicit
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || body.order_id || "");
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });
  const p = findCryptoPayment(orderId);
  if (!p) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (p.userId !== userId) return NextResponse.json({ error: "Not your order" }, { status: 403 });
  const verified = await verifyAndAutoActivate(orderId);
  return NextResponse.json({ payment: verified || p, verified: !!verified?.licenseKey || verified?.status !== p.status });
}
