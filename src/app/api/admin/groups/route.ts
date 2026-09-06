import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin";
import { getGroups, saveGroups, queryGroups, getGroupStats, upsertGroupLink, getGroupById } from "@/lib/groups-db";
import { normalizeGroupLink, isValidGroupLink } from "@/lib/group-links";
import { getUsers } from "@/lib/db";
import { verifyToken } from "@/lib/auth";

function getUserFromReq(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) as any : null;
  if (!p?.id) return null;
  return getUsers().find((u) => u.id === p.id) || null;
}

// GET /api/admin/groups — list with search, filters, pagination, sort
export async function GET(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;

  const url = new URL(req.url);
  const q = {
    search: url.searchParams.get("search") || undefined,
    categoryId: url.searchParams.get("categoryId") || url.searchParams.get("category_id") || undefined,
    groupType: url.searchParams.get("groupType") || url.searchParams.get("group_type") || undefined,
    status: url.searchParams.get("status") || undefined,
    source: url.searchParams.get("source") || undefined,
    dateFrom: url.searchParams.get("dateFrom") || url.searchParams.get("date_from") || undefined,
    dateTo: url.searchParams.get("dateTo") || url.searchParams.get("date_to") || undefined,
    sortBy: url.searchParams.get("sortBy") || url.searchParams.get("sort_by") || "first_added_at",
    sortDir: (url.searchParams.get("sortDir") || url.searchParams.get("sort_dir") || "desc") as "asc" | "desc",
    page: parseInt(url.searchParams.get("page") || "1") || 1,
    limit: parseInt(url.searchParams.get("limit") || "20") || 20,
  };

  // stats always included for dashboard
  const stats = getGroupStats();
  const result = queryGroups(q);
  return NextResponse.json({ ...result, stats });
}

// POST /api/admin/groups — manually add a group (source=admin)
export async function POST(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;
  const user = getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawLink = String(body.group_link || body.link || "").trim();
  if (!rawLink) return NextResponse.json({ error: "Group link required" }, { status: 400 });
  if (!isValidGroupLink(rawLink)) return NextResponse.json({ error: "Invalid Telegram group link. Use t.me/username or t.me/+inviteHash or t.me/joinchat/..." }, { status: 400 });

  try {
    // "Show in Browse" toggle: unchecked means the group is stored but hidden from premium users.
    // We model hidden as status=inactive, visible+active as status=active.
    const showInBrowse = body.show_in_browse !== false && body.showInBrowse !== false;
    const requestedStatus = body.status || "active";
    const status = showInBrowse ? requestedStatus : requestedStatus === "active" ? "inactive" : requestedStatus;
    const res = upsertGroupLink({
      rawLink,
      submittedBy: (user as any).id,
      submittedByEmail: (user as any).email,
      submittedByName: (user as any).name || (user as any).email,
      source: "admin",
      groupName: body.group_name || body.groupName || null,
      categoryId: body.category_id || body.categoryId || null,
      status,
      notes: body.notes || null,
      adminNotes: body.admin_notes || body.adminNotes || null,
    });
    return NextResponse.json({ ok: true, group: res.group, isNew: res.isNew, message: res.isNew ? "Group added" : "Group already exists — last_seen updated" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// PATCH /api/admin/groups — bulk or single update (category, status, notes)
export async function PATCH(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const groups = getGroups();
  let updated = 0;

  // Bulk: { ids: [...], patch: { category_id, status, ... } }
  if (Array.isArray(body.ids) && body.patch) {
    const patch = body.patch;
    for (const id of body.ids) {
      const g = groups.find((x) => x.id === id);
      if (!g) continue;
      if (patch.category_id !== undefined) {
        const { getCategoryById } = await import("@/lib/groups-db");
        const cat = getCategoryById(patch.category_id);
        if (cat) {
          g.category_id = cat.id;
          g.category_name = cat.name;
        } else if (patch.category_id === "cat_uncategorized" || patch.category_id === null) {
          g.category_id = "cat_uncategorized";
          g.category_name = "Uncategorized";
        }
      }
      if (patch.category_name !== undefined) g.category_name = patch.category_name;
      if (patch.status !== undefined) g.status = patch.status;
      if (patch.notes !== undefined) g.notes = patch.notes;
      if (patch.admin_notes !== undefined) g.admin_notes = patch.admin_notes;
      if (patch.group_name !== undefined) g.group_name = patch.group_name;
      g.updated_at = new Date().toISOString();
      updated++;
    }
    saveGroups(groups);
    return NextResponse.json({ ok: true, updated });
  }

  // Single: { id, patch: {...} }
  if (body.id && body.patch) {
    const g = groups.find((x) => x.id === body.id);
    if (!g) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    const patch = body.patch;
    if (patch.group_link !== undefined) {
      const raw = String(patch.group_link).trim();
      if (!isValidGroupLink(raw)) return NextResponse.json({ error: "Invalid group link" }, { status: 400 });
      const normalized = normalizeGroupLink(raw);
      // check duplicate (other record)
      const dup = groups.find((x) => x.id !== g.id && x.normalized_link === normalized);
      if (dup) return NextResponse.json({ error: "Another group with this link already exists" }, { status: 409 });
      g.group_link = raw;
      g.normalized_link = normalized;
      const { detectGroupType, extractUsername } = await import("@/lib/group-links");
      g.group_type = detectGroupType(raw) as any;
      g.group_username = extractUsername(normalized);
    }
    if (patch.category_id !== undefined) {
      const { getCategoryById } = await import("@/lib/groups-db");
      const cat = getCategoryById(patch.category_id);
      if (cat) {
        g.category_id = cat.id;
        g.category_name = cat.name;
      }
    }
    if (patch.status !== undefined) g.status = patch.status;
    if (patch.notes !== undefined) g.notes = patch.notes;
    if (patch.admin_notes !== undefined) g.admin_notes = patch.admin_notes;
    if (patch.group_name !== undefined) g.group_name = patch.group_name;
    g.updated_at = new Date().toISOString();
    saveGroups(groups);
    return NextResponse.json({ ok: true, group: g });
  }

  return NextResponse.json({ error: "Provide { ids, patch } or { id, patch }" }, { status: 400 });
}

// DELETE /api/admin/groups?id=xxx or body { ids: [...] }
export async function DELETE(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  let body: any = null;
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {}

  const ids: string[] = [];
  if (id) ids.push(id);
  if (body?.id) ids.push(body.id);
  if (Array.isArray(body?.ids)) ids.push(...body.ids);

  if (!ids.length) return NextResponse.json({ error: "Provide id or ids" }, { status: 400 });

  const groups = getGroups();
  const before = groups.length;
  const remaining = groups.filter((g) => !ids.includes(g.id));
  const deleted = before - remaining.length;
  saveGroups(remaining);
  return NextResponse.json({ ok: true, deleted });
}
