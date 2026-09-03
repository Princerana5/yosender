import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { getLicenseKeys, saveLicenseKeys, generateKeyCode } from "@/lib/subscriptions";
import { PLANS, PlanId } from "@/lib/plans";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "keys")) return NextResponse.json({ error: "No permission: keys" }, { status: 403 });
  const keys = getLicenseKeys().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ keys, plans: PLANS });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "keys")) return NextResponse.json({ error: "No permission: keys" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const planId = String(body.planId || "") as PlanId;
  const billing = String(body.billing || "monthly") as "daily" | "monthly";
  const count = Math.max(1, Math.min(100, Number(body.count) || 1));
  if (!(PLANS as any)[planId]) return NextResponse.json({ error: "Invalid planId" }, { status: 400 });
  if (billing !== "daily" && billing !== "monthly") return NextResponse.json({ error: "billing must be daily|monthly" }, { status: 400 });
  if ((PLANS as any)[planId].id === "luxe" && billing === "daily") return NextResponse.json({ error: "Luxe is monthly only" }, { status: 400 });

  const keys = getLicenseKeys();
  const created: any[] = [];
  for (let i = 0; i < count; i++) {
    const code = generateKeyCode(planId, billing);
    const k: any = {
      id: `key_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}_${i}`,
      code,
      planId,
      billing,
      status: "unused",
      createdAt: new Date().toISOString(),
      usedBy: null,
      usedAt: null,
      note: body.note || "",
    };
    keys.unshift(k);
    created.push(k);
  }
  saveLicenseKeys(keys);
  return NextResponse.json({ ok: true, keys: created });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "keys")) return NextResponse.json({ error: "No permission: keys" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "");
  const keys = getLicenseKeys();
  const k = keys.find(x => x.id === id);
  if (!k) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  if (action === "revoke") { k.status = "revoked"; saveLicenseKeys(keys); return NextResponse.json({ ok: true, key: k }); }
  if (action === "unrevoke" && k.status === "revoked") { k.status = k.usedBy ? "used" : "unused"; saveLicenseKeys(keys); return NextResponse.json({ ok: true, key: k }); }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
