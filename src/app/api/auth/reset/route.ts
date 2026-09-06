import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, saveUsers } from "@/lib/db";

// POST /api/auth/reset — { token, newPassword } → sets new password.
export async function POST(req: NextRequest) {
  const { token, newPassword } = await req.json().catch(() => ({}));
  if (!token || !newPassword) {
    return NextResponse.json({ error: "Token and new password required" }, { status: 400 });
  }
  if (String(newPassword).length < 6) {
    return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });
  }
  const users = getUsers();
  const idx = users.findIndex((u) => (u as any).resetToken === String(token));
  if (idx === -1) {
    return NextResponse.json({ error: "Invalid or used reset link — request a new one." }, { status: 400 });
  }
  const exp = (users[idx] as any).resetExpires;
  if (!exp || new Date(exp).getTime() < Date.now()) {
    // clear stale token
    delete (users[idx] as any).resetToken;
    delete (users[idx] as any).resetExpires;
    saveUsers(users);
    return NextResponse.json({ error: "Reset link expired — request a new one." }, { status: 400 });
  }
  users[idx].passwordHash = await bcrypt.hash(String(newPassword), 10);
  delete (users[idx] as any).resetToken;
  delete (users[idx] as any).resetExpires;
  saveUsers(users);
  return NextResponse.json({ ok: true, message: "Password updated — sign in now." });
}
