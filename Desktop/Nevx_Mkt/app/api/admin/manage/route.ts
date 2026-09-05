import { NextResponse } from "next/server";
import { db, persist, uid } from "@/lib/db";
import { publicUser } from "@/lib/db";
import { currentSession } from "@/lib/auth";

async function mustAdmin() {
  const s = await currentSession();
  if (!s) return null;
  const d = db();
  const me = d.users.find((u) => u.id === s.id);
  return me && me.role !== "USER" ? { d, me } : null;
}

const FLAG_CODES: Record<string, string> = {
  Global: "world", India: "in", "United States": "us", China: "cn", Germany: "de",
  "United Arab Emirates": "ae", "United Kingdom": "gb", Canada: "ca", Australia: "au",
  Singapore: "sg", Brazil: "br", France: "fr", Japan: "jp",
};

/** GET ?scope=users|groups|categories|requests|reports */
export async function GET(req: Request) {
  const ctx = await mustAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { d } = ctx;
  const scope = new URL(req.url).searchParams.get("scope") || "users";

  if (scope === "users") {
    return NextResponse.json({
      users: d.users.map((u) => ({
        ...publicUser(u),
        email: u.email,
        role: u.role,
        status: u.status,
        needs: d.needs.filter((n) => n.userId === u.id).length,
        offers: d.offers.filter((o) => o.userId === u.id).length,
      })),
    });
  }
  if (scope === "groups") return NextResponse.json({ groups: d.groups });
  if (scope === "categories") return NextResponse.json({ categories: d.categories });
  if (scope === "requests") {
    return NextResponse.json({
      needs: d.needs.map((n) => ({ ...n, kind: "need" as const })),
      offers: d.offers.map((o) => ({ ...o, kind: "offer" as const })),
    });
  }
  if (scope === "reports") {
    return NextResponse.json({
      reports: d.reports.map((r) => {
        const reporter = d.users.find((u) => u.id === r.reporterId);
        let target = r.targetId;
        if (r.targetType === "need") target = d.needs.find((n) => n.id === r.targetId)?.title || target;
        if (r.targetType === "offer") target = d.offers.find((o) => o.id === r.targetId)?.title || target;
        if (r.targetType === "user") target = d.users.find((u) => u.id === r.targetId)?.name || target;
        return { ...r, reporter: reporter?.name || "?", target };
      }),
    });
  }
  return NextResponse.json({ error: "Unknown scope." }, { status: 400 });
}

export async function POST(req: Request) {
  const ctx = await mustAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { d } = ctx;
  const body = await req.json().catch(() => ({}));
  const { scope } = body;

  // ---- users ----
  if (scope === "user-status") {
    const u = d.users.find((x) => x.id === body.id);
    if (!u) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (u.role === "SUPER_ADMIN") return NextResponse.json({ error: "Cannot change super admin." }, { status: 400 });
    if (["ACTIVE", "SUSPENDED", "BANNED"].includes(body.status)) u.status = body.status;
    if (body.role === "USER" || body.role === "ADMIN") u.role = body.role;
    if (typeof body.verified === "boolean") u.verified = body.verified;
    persist();
    return NextResponse.json({ ok: true });
  }
  // ---- groups ----
  if (scope === "group-create") {
    const name = String(body.name || "").trim().toUpperCase();
    if (!name) return NextResponse.json({ error: "Group name required." }, { status: 400 });
    const country = String(body.country || "Global");
    d.groups.push({
      id: uid("g"),
      name,
      code: FLAG_CODES[country] || "world",
      country,
      active: true,
      order: d.groups.length,
    });
    persist();
    return NextResponse.json({ ok: true });
  }
  if (scope === "group-toggle") {
    const g = d.groups.find((x) => x.id === body.id);
    if (!g) return NextResponse.json({ error: "Group not found." }, { status: 404 });
    g.active = !g.active;
    persist();
    return NextResponse.json({ ok: true });
  }
  if (scope === "group-delete") {
    const i = d.groups.findIndex((x) => x.id === body.id);
    if (i < 0) return NextResponse.json({ error: "Group not found." }, { status: 404 });
    if (["g_world"].includes(d.groups[i].id)) {
      return NextResponse.json({ error: "WORLD group cannot be deleted." }, { status: 400 });
    }
    // move posts to WORLD instead of orphaning
    for (const n of d.needs) if (n.groupId === body.id) n.groupId = "g_world";
    for (const o of d.offers) if (o.groupId === body.id) o.groupId = "g_world";
    d.groups.splice(i, 1);
    persist();
    return NextResponse.json({ ok: true });
  }
  if (scope === "move-post") {
    const { kind, id, groupId } = body;
    const g = d.groups.find((x) => x.id === groupId);
    if (!g) return NextResponse.json({ error: "Group not found." }, { status: 404 });
    const item =
      kind === "need" ? d.needs.find((n) => n.id === id) : d.offers.find((o) => o.id === id);
    if (!item) return NextResponse.json({ error: "Post not found." }, { status: 404 });
    item.groupId = groupId;
    persist();
    return NextResponse.json({ ok: true });
  }
  // ---- categories ----
  if (scope === "category-create") {
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Category name required." }, { status: 400 });
    d.categories.push({ id: uid("c"), name, icon: String(body.icon || "📦") });
    persist();
    return NextResponse.json({ ok: true });
  }
  if (scope === "category-delete") {
    d.categories = d.categories.filter((c) => c.id !== body.id);
    persist();
    return NextResponse.json({ ok: true });
  }
  // ---- moderation ----
  if (scope === "post-status") {
    const { kind, id, status } = body;
    if (!["ACTIVE", "HIDDEN", "DELETED", "COMPLETED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    const item =
      kind === "need" ? d.needs.find((n) => n.id === id) : d.offers.find((o) => o.id === id);
    if (!item) return NextResponse.json({ error: "Post not found." }, { status: 404 });
    item.status = status;
    persist();
    return NextResponse.json({ ok: true });
  }
  if (scope === "report-resolve") {
    const r = d.reports.find((x) => x.id === body.id);
    if (!r) return NextResponse.json({ error: "Report not found." }, { status: 404 });
    r.status = body.decision === "dismiss" ? "DISMISSED" : "RESOLVED";
    persist();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
