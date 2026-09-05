import { NextResponse } from "next/server";
import { db, persist } from "@/lib/db";
import { currentSession } from "@/lib/auth";

export async function POST(req: Request) {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const d = db();
  if (body.all) {
    for (const n of d.notifications) if (n.userId === s.id) n.read = true;
  } else if (body.id) {
    const n = d.notifications.find((x) => x.id === body.id && x.userId === s.id);
    if (n) n.read = true;
  }
  persist();
  return NextResponse.json({ ok: true });
}
