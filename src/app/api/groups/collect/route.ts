import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUsers } from "@/lib/db";
import { upsertGroupLink, bulkUpsertGroupLinks } from "@/lib/groups-db";
import { isValidGroupLink } from "@/lib/group-links";

function getUserFromReq(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  if (!t) return null;
  const p = verifyToken(t) as any;
  if (!p?.id) return null;
  const u = getUsers().find((x) => x.id === p.id);
  if (!u) return null;
  return u;
}

// POST /api/groups/collect — auto-collect group links (called whenever user submits links anywhere)
export async function POST(req: NextRequest) {
  const user = getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawLinks: string[] = [];
  if (typeof body.link === "string" && body.link.trim()) rawLinks.push(body.link.trim());
  if (typeof body.group_link === "string" && body.group_link.trim()) rawLinks.push(body.group_link.trim());
  if (Array.isArray(body.links)) rawLinks.push(...body.links.map((s: any) => String(s || "").trim()).filter(Boolean));
  if (Array.isArray(body.group_links)) rawLinks.push(...body.group_links.map((s: any) => String(s || "").trim()).filter(Boolean));
  // also support newline-separated string
  if (typeof body.text === "string") {
    const parts = body.text.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean);
    rawLinks.push(...parts);
  }

  if (!rawLinks.length) return NextResponse.json({ error: "No group links provided" }, { status: 400 });

  // dedupe input
  const uniqueInput = [...new Set(rawLinks.map((s) => s.trim()).filter(Boolean))];

  const result = bulkUpsertGroupLinks(uniqueInput, {
    submittedBy: (user as any).id,
    submittedByEmail: (user as any).email,
    submittedByName: (user as any).name || (user as any).email,
    source: "user",
  });

  return NextResponse.json({
    ok: true,
    total: result.total,
    valid: result.valid,
    newGroups: result.newGroups,
    duplicates: result.duplicates,
    invalid: result.invalid,
    errors: result.errors.slice(0, 20), // limit
  });
}
