import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicUser } from "@/lib/db";
import { currentSession } from "@/lib/auth";

export async function GET() {
  const s = await currentSession();
  if (!s) return NextResponse.json({ user: null });
  const d = db();
  const u = d.users.find((x) => x.id === s.id);
  if (!u || u.status !== "ACTIVE") return NextResponse.json({ user: null });
  return NextResponse.json({
    user: { ...publicUser(u), role: u.role, email: u.email },
  });
}
