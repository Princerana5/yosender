import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin";
import { getGroups, saveGroups, getCategoryById } from "@/lib/groups-db";

// POST /api/admin/groups/bulk-category — { ids: string[], category_id: string }
export async function POST(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.ids) || !body.ids.length)
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  if (!body.category_id) return NextResponse.json({ error: "category_id required" }, { status: 400 });

  const cat = getCategoryById(body.category_id);
  if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  const groups = getGroups();
  let updated = 0;
  const now = new Date().toISOString();
  for (const id of body.ids) {
    const g = groups.find((x) => x.id === id);
    if (!g) continue;
    g.category_id = cat.id;
    g.category_name = cat.name;
    g.updated_at = now;
    updated++;
  }
  saveGroups(groups);
  return NextResponse.json({ ok: true, updated, category: cat.name });
}
