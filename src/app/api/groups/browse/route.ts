import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUsers } from "@/lib/db";
import { getActiveSubscription } from "@/lib/subscriptions";
import { getPlan } from "@/lib/plans";
import { getGroups, getCategories } from "@/lib/groups-db";

function getUserFromReq(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  if (!t) return null;
  const p = verifyToken(t) as any;
  if (!p?.id) return null;
  return getUsers().find((x) => x.id === p.id) || null;
}

// GET /api/groups/browse — group catalog, visible to everyone.
// Free users see the full catalog (names, categories, types) but invite links
// stay masked and joining is blocked until they activate a plan — otherwise
// the t.me links could be copy-pasted into Telegram, bypassing premium.
export async function GET(req: NextRequest) {
  const user = getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

  const sub = getActiveSubscription((user as any).id);
  const plan = sub ? getPlan(sub.planId) : null;
  const locked = !plan;

  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId") || "";
  const search = (url.searchParams.get("search") || "").toLowerCase().trim();
  const groupType = url.searchParams.get("groupType") || url.searchParams.get("type") || "";

  let groups = getGroups().filter((g) => g.status === "active");
  if (categoryId) groups = groups.filter((g) => g.category_id === categoryId);
  if (groupType === "public" || groupType === "private") groups = groups.filter((g) => g.group_type === groupType);
  if (search) {
    groups = groups.filter(
      (g) =>
        (g.group_name || "").toLowerCase().includes(search) ||
        (g.group_username || "").toLowerCase().includes(search) ||
        g.group_link.toLowerCase().includes(search) ||
        g.normalized_link.toLowerCase().includes(search) ||
        g.category_name.toLowerCase().includes(search)
    );
  }
  groups.sort((a, b) => {
    if (a.category_name !== b.category_name) return a.category_name.localeCompare(b.category_name);
    return (a.group_name || a.group_username || a.group_link).localeCompare(b.group_name || b.group_username || b.group_link);
  });

  const cats = getCategories();
  const allGroups = getGroups();
  const allActive = allGroups.filter((g) => g.status === "active");
  // Aggregate member counts (groups without a resolved count are excluded)
  const totalMembers = allActive.reduce(
    (sum, g) => sum + (typeof g.member_count === "number" ? g.member_count : 0),
    0
  );
  const withMembers = allActive.filter((g) => typeof g.member_count === "number").length;
  const categories = cats
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      color: c.color,
      count: allActive.filter((g) => g.category_id === c.id).length,
    }))
    .filter((c) => c.count > 0 || c.id === "cat_uncategorized");

  // Locked users see the catalog but never the real invite links:
  // group_link is masked, normalized_link is removed, username hidden for
  // private invites. notes stay admin-only. Member counts stay visible for all.
  const safe = groups.map((g) => {
    const memberCount = typeof g.member_count === "number" ? g.member_count : null;
    // null = unknown (no badge); true/false = known snapshot.
    const noSend = (g as any).send_restricted === true ? true : (g as any).send_restricted === false ? false : null;
    if (!locked) {
      return {
        id: g.id,
        group_link: g.group_link,
        normalized_link: g.normalized_link,
        group_type: g.group_type,
        group_name: g.group_name,
        group_username: g.group_username,
        category_id: g.category_id,
        category_name: g.category_name,
        notes: g.notes,
        member_count: memberCount,
        send_restricted: noSend,
      };
    }
    return {
      id: g.id,
      locked: true,
      group_link: null,
      normalized_link: null,
      group_type: g.group_type,
      // private invite links have no public name/username — keep generic so
      // nothing joinable leaks through the masked catalog
      group_name: g.group_type === "private" ? `${g.category_name} group` : g.group_name,
      group_username: g.group_type === "private" ? null : g.group_username,
      category_id: g.category_id,
      category_name: g.category_name,
      notes: null,
      member_count: memberCount,
      send_restricted: noSend,
    };
  });

  return NextResponse.json({
    ok: true,
    plan: plan ? plan.name : null,
    locked,
    premiumRequired: locked || undefined,
    groups: safe,
    total: safe.length,
    totalMembers,
    withMembers,
    categories,
  });
}
