import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentSession } from "@/lib/auth";

export async function GET() {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const d = db();
  const deals = d.deals
    .filter((x) => x.buyerId === s.id || x.sellerId === s.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((x) => ({ ...x, role: x.buyerId === s.id ? "buyer" : "seller" }));
  return NextResponse.json({ deals });
}
