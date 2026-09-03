import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyToken } from "@/lib/auth";
import { getUsers, saveUsers } from "@/lib/db";

function getUid(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

export async function POST(req: NextRequest) {
  const uid = getUid(req);
  if (!uid) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  if (!currentPassword || !newPassword) return NextResponse.json({ error: "All fields required" }, { status: 400 });
  if (String(newPassword).length < 6) return NextResponse.json({ error: "New password min 6 chars" }, { status: 400 });

  const users = getUsers();
  const idx = users.findIndex((u) => u.id === uid);
  if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const ok = await bcrypt.compare(String(currentPassword), users[idx].passwordHash);
  if (!ok) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });

  users[idx].passwordHash = await bcrypt.hash(String(newPassword), 10);
  saveUsers(users);
  return NextResponse.json({ ok: true });
}
