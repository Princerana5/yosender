import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, saveUsers } from "@/lib/db";
import { signToken } from "@/lib/auth";
export async function POST(req: NextRequest) {
  const { name, email, password, telegramUsername } = await req.json();
  if (!name || !email || !password) return NextResponse.json({ error: "All fields required" }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });
  const users = getUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  const passwordHash = await bcrypt.hash(password, 10);
  const tgUser = String(telegramUsername || "").trim().replace(/^@/, "");
  const user: any = { id: (globalThis.crypto as any)?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2,9)}`, name, email: email.toLowerCase(), passwordHash, createdAt: new Date().toISOString(), telegramUsername: tgUser || undefined };
  users.push(user); saveUsers(users);
  const token = signToken({ id: user.id, email: user.email, name: user.name, telegramUsername: user.telegramUsername });
  const res = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, telegramUsername: user.telegramUsername } });
  res.cookies.set("auth_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
