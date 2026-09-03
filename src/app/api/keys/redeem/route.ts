import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getLicenseKeys, saveLicenseKeys, getSubscriptions, saveSubscriptions } from "@/lib/subscriptions";
import { PLANS } from "@/lib/plans";

function uid(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

export async function POST(req: NextRequest) {
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { code } = await req.json().catch(() => ({}));
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return NextResponse.json({ error: "Enter license key" }, { status: 400 });

  const keys = getLicenseKeys();
  const k = keys.find(x => x.code.toUpperCase() === raw);
  if (!k) return NextResponse.json({ error: "Invalid license key" }, { status: 404 });
  if (k.status !== "unused") return NextResponse.json({ error: k.status === "used" ? "Key already redeemed" : "Key revoked" }, { status: 409 });
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return NextResponse.json({ error: "Key expired" }, { status: 410 });

  const plan = (PLANS as any)[k.planId];
  if (!plan) return NextResponse.json({ error: "Invalid plan on key" }, { status: 500 });

  const now = new Date();
  const days = k.billing === "daily" ? 1 : 30;
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  k.status = "used";
  k.usedBy = id;
  k.usedAt = now.toISOString();
  saveLicenseKeys(keys);

  const subs = getSubscriptions();
  const sub: any = {
    id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    userId: id,
    planId: k.planId,
    billing: k.billing,
    keyId: k.id,
    keyCode: k.code,
    activatedAt: now.toISOString(),
    expiresAt,
    status: "active",
  };
  subs.unshift(sub);
  saveSubscriptions(subs);

  return NextResponse.json({ ok: true, subscription: sub, plan, message: `${plan.name} activated — valid till ${new Date(expiresAt).toLocaleString()}` });
}
