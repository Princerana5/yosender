import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { getCampaigns, getUsers } from "@/lib/db";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "campaigns")) return NextResponse.json({ error: "No permission: campaigns" }, { status: 403 });
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const status = url.searchParams.get("status") || "all";

  let all = getCampaigns().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (search) all = all.filter(c => c.name.toLowerCase().includes(search) || c.userId.toLowerCase().includes(search));
  if (status !== "all") all = all.filter(c => c.status === status);

  const total = all.length;
  const start = (page - 1) * limit;
  const pageCamps = all.slice(start, start + limit);

  const users = getUsers();
  const enriched = pageCamps.map(c => {
    const u = users.find(u => u.id === c.userId);
    return {
      ...c,
      userEmail: u?.email || "Unknown",
      userName: u?.name || "Unknown",
    };
  });

  return NextResponse.json({ campaigns: enriched, total, page, limit, totalPages: Math.ceil(total / limit) });
}
