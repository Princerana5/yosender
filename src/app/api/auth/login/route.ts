import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, saveUsers } from "@/lib/db";
import { signToken } from "@/lib/auth";
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const user = getUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  if ((user as any).isBanned) return NextResponse.json({ error: "Account banned — contact support" }, { status: 403 });
  if (!await bcrypt.compare(password, user.passwordHash)) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  // update last login
  try { const users = getUsers(); const idx = users.findIndex(u => u.id === user.id); if (idx !== -1) { (users[idx] as any).lastLoginAt = new Date().toISOString(); saveUsers(users); } } catch {}
  const token = signToken({ id: user.id, email: user.email, name: user.name });
  const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  res.cookies.set("auth_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
