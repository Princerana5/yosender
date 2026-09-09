import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getTemplates, saveTemplates } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uid(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

function safe(t: any) {
  const { userId, ...rest } = t || {};
  return rest;
}

export async function GET(req: NextRequest) {
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const list = getTemplates()
    .filter((t) => t.userId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(safe);
  return NextResponse.json({ templates: list });
}

export async function POST(req: NextRequest) {
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const message = String(body.message || "");
  const image = body.image ? String(body.image) : null;
  if (!name) return NextResponse.json({ error: "Template name required" }, { status: 400 });
  if (!message.trim() && !image) return NextResponse.json({ error: "Add text or image" }, { status: 400 });
  // Cap image size (~2MB data URL) so one template can't bloat templates.json
  if (image && image.length > 2.5 * 1024 * 1024) {
    return NextResponse.json({ error: "Image too large (max ~2MB) — use a smaller image" }, { status: 400 });
  }
  const all = getTemplates();
  const t: any = {
    id: (globalThis.crypto as any)?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`,
    userId: id,
    name,
    message,
    category: String(body.category || "General"),
    image,
    createdAt: new Date().toISOString(),
  };
  all.unshift(t);
  saveTemplates(all);
  return NextResponse.json({ template: safe(t) });
}

export async function PATCH(req: NextRequest) {
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { patchId, patch } = await req.json().catch(() => ({}));
  if (!patchId) return NextResponse.json({ error: "patchId required" }, { status: 400 });
  const all = getTemplates();
  const idx = all.findIndex((t) => t.id === String(patchId) && t.userId === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const image = patch?.image !== undefined ? (patch.image ? String(patch.image) : null) : all[idx].image;
  if (image && image.length > 2.5 * 1024 * 1024) {
    return NextResponse.json({ error: "Image too large (max ~2MB) — use a smaller image" }, { status: 400 });
  }
  const next: any = { ...all[idx] };
  if (patch?.name !== undefined) next.name = String(patch.name).trim() || next.name;
  if (patch?.message !== undefined) next.message = String(patch.message);
  if (patch?.category !== undefined) next.category = String(patch.category);
  if (patch?.image !== undefined) next.image = image;
  all[idx] = next;
  saveTemplates(all);
  return NextResponse.json({ template: safe(next) });
}

export async function DELETE(req: NextRequest) {
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const tid = searchParams.get("id");
  if (!tid) return NextResponse.json({ error: "id required" }, { status: 400 });
  const all = getTemplates();
  const idx = all.findIndex((t) => t.id === String(tid) && t.userId === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  all.splice(idx, 1);
  saveTemplates(all);
  return NextResponse.json({ ok: true });
}
