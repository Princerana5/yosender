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

  let offers = d.offers.filter((o) => o.status === "ACTIVE");
  if (groupId) offers = offers.filter((o) => o.groupId === groupId);
  if (category) offers = offers.filter((o) => o.category === category);
  if (q) {
    offers = offers.filter((o) =>
      `${o.title} ${o.description} ${o.category}`.toLowerCase().includes(q)
    );
  }
  offers.sort((a, b) =>
    sort === "oldest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt
  );

  const users = new Map(d.users.map((u) => [u.id, u]));
  return NextResponse.json({
    offers: offers.map((o) => {
      const u = users.get(o.userId);
      return {
        ...o,
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
  const { title, description, category, price, priceType, country, groupId, deliveryTime } = body;
  if (!title?.trim() || !description?.trim() || !category || !groupId) {
    return NextResponse.json(
      { error: "Title, description, category and group are required." },
      { status: 400 }
    );
  }
  if (price === undefined || price === "" || Number(price) < 0) {
    return NextResponse.json({ error: "Please enter a valid price." }, { status: 400 });
  }
  const d = db();
  const group = d.groups.find((g) => g.id === groupId && g.active);
  if (!group) return NextResponse.json({ error: "Invalid group." }, { status: 400 });

  const offer = {
    id: uid("o"),
    userId: s.id,
    groupId,
    title: String(title).trim().slice(0, 120),
    description: String(description).trim().slice(0, 2000),
    category: String(category),
    price: Number(price),
    priceType: (priceType as "fixed" | "from" | "negotiable") || "fixed",
    country: String(country || d.users.find((u) => u.id === s.id)?.country || ""),
    deliveryTime: deliveryTime ? String(deliveryTime).slice(0, 60) : undefined,
    status: "ACTIVE" as const,
    createdAt: Date.now(),
  };
  d.offers.unshift(offer);
  for (const a of d.users.filter((u) => u.role !== "USER")) {
    notify(a.id, "🏷️", `New offer posted: “${offer.title}”`, "/admin/requests");
  }
  persist();
  return NextResponse.json({ ok: true, offer });
}
