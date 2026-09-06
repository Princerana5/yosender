import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin";
import {
  getCategories,
  saveCategories,
  createCategory,
  getGroups,
  saveGroups,
} from "@/lib/groups-db";

// GET /api/admin/categories — list with counts
export async function GET(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;
  const cats = getCategories();
  const groups = getGroups();
  const withCounts = cats.map((c) => ({
    ...c,
    groupCount: groups.filter((g) => g.category_id === c.id).length,
  }));
  return NextResponse.json({ categories: withCounts });
}

// POST /api/admin/categories — { name, color? }
export async function POST(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Category name required" }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "Name max 60 chars" }, { status: 400 });
  try {
    const cat = createCategory(name, body.color);
    return NextResponse.json({ ok: true, category: cat });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// PATCH /api/admin/categories — { id, name?, color? }
export async function PATCH(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const cats = getCategories();
  const cat = cats.find((c) => c.id === body.id);
  if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  if (cat.id === "cat_uncategorized" && body.name && body.name !== "Uncategorized") {
    return NextResponse.json({ error: "Cannot rename Uncategorized" }, { status: 400 });
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (cats.find((c) => c.id !== cat.id && c.name.toLowerCase() === name.toLowerCase()))
      return NextResponse.json({ error: "Category name already exists" }, { status: 409 });
    cat.name = name;
    cat.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  if (body.color !== undefined) cat.color = String(body.color);
  cat.updated_at = new Date().toISOString();
  saveCategories(cats);
  // sync category_name on groups
  const groups = getGroups();
  let synced = 0;
  for (const g of groups) {
    if (g.category_id === cat.id && g.category_name !== cat.name) {
      g.category_name = cat.name;
      g.updated_at = new Date().toISOString();
      synced++;
    }
  }
  if (synced) saveGroups(groups);
  return NextResponse.json({ ok: true, category: cat, syncedGroups: synced });
}

// DELETE /api/admin/categories?id=xxx — groups move to Uncategorized
export async function DELETE(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === "cat_uncategorized") return NextResponse.json({ error: "Cannot delete Uncategorized" }, { status: 400 });
  const cats = getCategories();
  const idx = cats.findIndex((c) => c.id === id);
  if (idx === -1) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  cats.splice(idx, 1);
  saveCategories(cats);
  // move groups to Uncategorized
  const groups = getGroups();
  let moved = 0;
  for (const g of groups) {
    if (g.category_id === id) {
      g.category_id = "cat_uncategorized";
      g.category_name = "Uncategorized";
      g.updated_at = new Date().toISOString();
      moved++;
    }
  }
  if (moved) saveGroups(groups);
  return NextResponse.json({ ok: true, movedToUncategorized: moved });
}
