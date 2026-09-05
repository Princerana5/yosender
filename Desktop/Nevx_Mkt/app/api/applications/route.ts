import { NextResponse } from "next/server";
import { db, persist, uid, notify } from "@/lib/db";
import { currentSession } from "@/lib/auth";

/** POST — seller applies to a need (goes to ADMIN, never to requester) */
export async function POST(req: Request) {
  const s = await currentSession();
  if (!s) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { needId, price, deliveryTime, message } = body;
  if (!needId || price === undefined || price === "" || !deliveryTime?.trim() || !message?.trim()) {
    return NextResponse.json(
      { error: "Price, delivery time and a message are required." },
      { status: 400 }
    );
  }
  const d = db();
  const need = d.needs.find((n) => n.id === needId && n.status === "ACTIVE");
  if (!need) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (need.userId === s.id) {
    return NextResponse.json({ error: "You can't apply to your own request." }, { status: 400 });
  }
  if (d.applications.some((a) => a.needId === needId && a.applicantId === s.id)) {
    return NextResponse.json({ error: "You've already applied to this request." }, { status: 409 });
  }

  const app = {
    id: uid("a"),
    needId,
    applicantId: s.id,
    price: Number(price),
    deliveryTime: String(deliveryTime).trim().slice(0, 80),
    message: String(message).trim().slice(0, 1000),
    status: "PENDING" as const,
    createdAt: Date.now(),
  };
  d.applications.unshift(app);
  need.applicationCount += 1;
  // Notify requester + admins
  notify(need.userId, "📥", `New application on “${need.title}”`, "/app/applications");
  for (const a of d.users.filter((u) => u.role !== "USER" && u.id !== need.userId)) {
    notify(a.id, "📥", `New application on “${need.title}”`, "/admin/applications");
  }
  persist();
  return NextResponse.json({ ok: true, application: app });
}
