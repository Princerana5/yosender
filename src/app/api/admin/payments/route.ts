import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm, getRequestEmail } from "@/lib/admin";
import { getCryptoPayments, findCryptoPayment, updateCryptoPayment } from "@/lib/crypto-payments";
import { getUsers } from "@/lib/db";
import { getLicenseKeys, saveLicenseKeys, generateKeyCode, getSubscriptions, saveSubscriptions } from "@/lib/subscriptions";
import { PLANS } from "@/lib/plans";
import { fetchNowPaymentsStatus, isPaidStatus } from "@/lib/nowpayments";

function enrich(payments: any[]) {
  const users = getUsers() as any[];
  const byId = new Map(users.map(u => [String(u.id), u]));
  return payments.map(p => {
    const u = byId.get(String(p.userId));
    return {
      ...p,
      userName: u?.name || p.userEmail?.split("@")[0] || "Unknown",
      userEmail: u?.email || p.userEmail || "—",
      planName: (PLANS as any)[p.planId]?.name || p.planId,
    };
  });
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  // payments visible to anyone with overview or subs or keys perm, or owner
  const email = getRequestEmail(req);
  const { getAdminEmails } = await import("@/lib/admin");
  const isOwner = getAdminEmails().includes(email);
  if (!isOwner && !hasPerm(req, "overview") && !hasPerm(req, "subs") && !hasPerm(req, "keys")) {
    return NextResponse.json({ error: "No permission: payments" }, { status: 403 });
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";
  const search = (url.searchParams.get("search") || "").toLowerCase().trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50") || 50));

  let all = getCryptoPayments().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (status !== "all") all = all.filter(p => p.status === status);
  if (search) {
    all = all.filter(p =>
      p.orderId.toLowerCase().includes(search) ||
      (p.userEmail || "").toLowerCase().includes(search) ||
      (p.planId || "").toLowerCase().includes(search) ||
      (p.licenseKey || "").toLowerCase().includes(search) ||
      String(p.amountUsd).includes(search)
    );
  }
  const total = all.length;
  const paged = all.slice((page - 1) * limit, page * limit);
  const enriched = enrich(paged);

  // Summary
  const allPayments = getCryptoPayments();
  const summary = {
    total: allPayments.length,
    waiting: allPayments.filter(p => p.status === "waiting").length,
    confirming: allPayments.filter(p => p.status === "confirming").length,
    finished: allPayments.filter(p => p.status === "finished").length,
    confirmed: allPayments.filter(p => p.status === "confirmed").length,
    failed: allPayments.filter(p => p.status === "failed").length,
    expired: allPayments.filter(p => p.status === "expired").length,
    revenueUsd: allPayments.filter(p => p.licenseKey).reduce((a, p) => a + (p.amountUsd || 0), 0),
    pendingRevenueUsd: allPayments.filter(p => !p.licenseKey && p.status === "waiting").reduce((a, p) => a + (p.amountUsd || 0), 0),
  };

  return NextResponse.json({ payments: enriched, total, page, limit, summary });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "subs") && !hasPerm(req, "keys") && !hasPerm(req, "overview")) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || body.order_id || "").trim();
  const action = String(body.action || "").trim(); // verify | confirm | force_confirm | mark_failed | mark_expired
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });
  if (!action) return NextResponse.json({ error: "action required: verify|confirm|force_confirm|mark_failed|mark_expired" }, { status: 400 });

  const order = findCryptoPayment(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (action === "verify") {
    // Try NOWPayments direct verify
    try {
      const fetched = await fetchNowPaymentsStatus({
        orderId: order.orderId,
        invoiceId: order.invoiceId || undefined,
        paymentId: order.paymentId || undefined,
      });
      if (fetched && fetched.status) {
        if (fetched.paymentId) updateCryptoPayment(orderId, { paymentId: fetched.paymentId, payCurrency: fetched.payCurrency || order.payCurrency });
        if (fetched.status !== order.status) updateCryptoPayment(orderId, { status: fetched.status as any });
        if (isPaidStatus(fetched.status) && !order.licenseKey) {
          // auto-activate
          const plan = (PLANS as any)[order.planId];
          if (plan) {
            const code = generateKeyCode(order.planId as any, order.billing as any);
            const now = new Date();
            const days = order.billing === "daily" ? 1 : 30;
            const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
            const keys = getLicenseKeys();
            const k: any = { id: `key_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, code, planId: order.planId, billing: order.billing, status: "used", createdAt: now.toISOString(), usedBy: order.userId, usedAt: now.toISOString(), note: `Admin verified — ${fetched.payCurrency || "crypto"} — order ${orderId} — ${fetched.status}` };
            keys.unshift(k); saveLicenseKeys(keys);
            const subs = getSubscriptions();
            const sub: any = { id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, userId: order.userId, planId: order.planId, billing: order.billing, keyId: k.id, keyCode: code, activatedAt: now.toISOString(), expiresAt, status: "active" };
            subs.unshift(sub); saveSubscriptions(subs);
            updateCryptoPayment(orderId, { licenseKey: code, licenseKeyId: k.id, status: fetched.status as any });
            const updated = findCryptoPayment(orderId);
            return NextResponse.json({ ok: true, verified: true, status: fetched.status, payment: enrich([updated!])[0], licenseKey: code, message: `Verified (${fetched.status}) — API key ${code} + plan activated!` });
          }
        }
        const updated = findCryptoPayment(orderId);
        return NextResponse.json({ ok: true, verified: true, status: fetched.status, payment: enrich([updated!])[0], message: `Status: ${fetched.status}` });
      }
    } catch (e: any) {
      console.warn("[admin payments verify]", e.message);
    }
    const updated = findCryptoPayment(orderId);
    return NextResponse.json({ ok: true, verified: false, payment: enrich([updated!])[0], message: "Could not verify with NOWPayments (needs JWT for payment list). Use Confirm/Force Confirm to activate manually." });
  }

  if (action === "confirm" || action === "force_confirm") {
    if (order.licenseKey) return NextResponse.json({ ok: true, already: true, payment: enrich([order])[0], message: "Already activated — " + order.licenseKey });
    const plan = (PLANS as any)[order.planId];
    if (!plan) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    const code = generateKeyCode(order.planId as any, order.billing as any);
    const now = new Date();
    const days = order.billing === "daily" ? 1 : 30;
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    const keys = getLicenseKeys();
    const k: any = { id: `key_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, code, planId: order.planId, billing: order.billing, status: "used", createdAt: now.toISOString(), usedBy: order.userId, usedAt: now.toISOString(), note: `Admin ${action} — order ${orderId} — ${order.payCurrency || "crypto"}` };
    keys.unshift(k); saveLicenseKeys(keys);
    const subs = getSubscriptions();
    const sub: any = { id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, userId: order.userId, planId: order.planId, billing: order.billing, keyId: k.id, keyCode: code, activatedAt: now.toISOString(), expiresAt, status: "active" };
    subs.unshift(sub); saveSubscriptions(subs);
    updateCryptoPayment(orderId, { licenseKey: code, licenseKeyId: k.id, status: "finished" as any });
    const updated = findCryptoPayment(orderId);
    return NextResponse.json({ ok: true, payment: enrich([updated!])[0], licenseKey: code, message: `✅ Confirmed — API key ${code} generated & plan activated till ${new Date(expiresAt).toLocaleDateString()}!` });
  }

  if (action === "mark_failed" || action === "mark_expired") {
    const s = action === "mark_failed" ? "failed" : "expired";
    updateCryptoPayment(orderId, { status: s as any });
    const updated = findCryptoPayment(orderId);
    return NextResponse.json({ ok: true, payment: enrich([updated!])[0], message: `Marked as ${s}` });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
