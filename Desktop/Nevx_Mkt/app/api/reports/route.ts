import { NextResponse } from "next/server";
import { db, persist, uid, notify } from "@/lib/db";
import { currentSession } from "@/lib/auth";

export async function POST(req: Request) {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { targetType, targetId, reason, details } = body;
  if (!["need", "offer", "user"].includes(targetType) || !targetId || !reason) {
    return NextResponse.json({ error: "Invalid report." }, { status: 400 });
  }
  const d = db();
  d.reports.unshift({
    id: uid("r"),
    reporterId: s.id,
    targetType,
    targetId,
    reason: String(reason).slice(0, 60),
    details: details ? String(details).slice(0, 500) : undefined,
    status: "OPEN",
    createdAt: Date.now(),
  });
  for (const a of d.users.filter((u) => u.role !== "USER")) {
    notify(a.id, "🚩", `New report: ${reason}`, "/admin/reports");
  }
  persist();
  return NextResponse.json({ ok: true });
}
