import { NextResponse } from "next/server";
import { db, persist, uid, notify } from "@/lib/db";
import { currentSession } from "@/lib/auth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("group");
  const q = (searchParams.get("q") || "").toLowerCase();
  const category = searchParams.get("category") || "";
  const sort = searchParams.get("sort") || "newest";
  const d = db();

  let needs = d.needs.filter((n) => n.status === "ACTIVE");
  if (groupId) needs = needs.filter((n) => n.groupId === groupId);
  if (category) needs = needs.filter((n) => n.category === category);
  if (q) {
    needs = needs.filter((n) =>
      `${n.title} ${n.description} ${n.category}`.toLowerCase().includes(q)
    );
  }
  if (sort === "oldest") needs.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === "popular")
    needs.sort((a, b) => b.applicationCount - a.applicationCount);
  else needs.sort((a, b) => b.createdAt - a.createdAt);

  const users = new Map(d.users.map((u) => [u.id, u]));
  return NextResponse.json({
    needs: needs.map((n) => {
      const u = users.get(n.userId);
      return {
        ...n,
        author: u
          ? { id: u.id, name: u.name, country: u.country, avatarColor: u.avatarColor, verified: u.verified }
          : null,
      };
    }),
  });
}

export async function POST(req: Request) {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { title, description, category, subcategory, budgetType, budgetMin, budgetMax, country, groupId, deadline } = body;
  if (!title?.trim() || !description?.trim() || !category || !groupId) {
    return NextResponse.json(
      { error: "Title, description, category and group are required." },
      { status: 400 }
    );
  }
  const d = db();
  const group = d.groups.find((g) => g.id === groupId && g.active);
  if (!group) return NextResponse.json({ error: "Invalid group." }, { status: 400 });

  const need = {
    id: uid("n"),
    userId: s.id,
    groupId,
    title: String(title).trim().slice(0, 120),
    description: String(description).trim().slice(0, 2000),
    category: String(category),
    subcategory: subcategory ? String(subcategory).slice(0, 80) : undefined,
    budgetType: (budgetType as "fixed" | "range" | "negotiable") || "negotiable",
    budgetMin: budgetMin ? Number(budgetMin) : undefined,
    budgetMax: budgetMax ? Number(budgetMax) : undefined,
    country: String(country || d.users.find((u) => u.id === s.id)?.country || ""),
    deadline: deadline ? String(deadline).slice(0, 60) : undefined,
    status: "ACTIVE" as const,
    applicationCount: 0,
    createdAt: Date.now(),
  };
  d.needs.unshift(need);
  // Notify admins of new request
  for (const a of d.users.filter((u) => u.role !== "USER")) {
    notify(a.id, "📝", `New need posted: “${need.title}”`, "/admin/requests");
  }
  persist();
  return NextResponse.json({ ok: true, need });
}
