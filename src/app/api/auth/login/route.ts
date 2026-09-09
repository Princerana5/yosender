import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, saveUsers } from "@/lib/db";
import { signToken } from "@/lib/auth";
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const user = getUsers().find(u => u.email.toLowerCase() === String(email).toLowerCase().trim());
  if (!user) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  if ((user as any).isBanned) return NextResponse.json({ error: "Account banned — contact support" }, { status: 403 });
  if (!user.passwordHash || !await bcrypt.compare(String(password), user.passwordHash)) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  // OTP gate: accounts created BEFORE email verification launched have no
  // emailVerified flag at all → grandfathered in. Only explicit false blocks.
  if ((user as any).emailVerified === false) {
    return NextResponse.json({ error: "Verify your email first — we sent you a code at signup. Sign up again to get a fresh code.", verifyRequired: true }, { status: 403 });
  }
  // update last login
  try { const users = getUsers(); const idx = users.findIndex(u => u.id === user.id); if (idx !== -1) { (users[idx] as any).lastLoginAt = new Date().toISOString(); saveUsers(users); } } catch {}
  const token = signToken({ id: user.id, email: user.email, name: user.name });
  const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  res.cookies.set("auth_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === "production" });
  return res;
}
