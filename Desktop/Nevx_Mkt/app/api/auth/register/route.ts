import { NextResponse } from "next/server";
import { db, persist, uid } from "@/lib/db";
import { hashPassword, signSession, sessionCookie } from "@/lib/auth";

const COLORS = ["#0e7490", "#7c3aed", "#db2777", "#059669", "#ea580c", "#4f46e5", "#0891b2", "#be185d"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { name, email, country, password, confirmPassword, telegram } = body;

  if (!name?.trim() || !email?.trim() || !country?.trim() || !password) {
    return NextResponse.json({ error: "Name, email, country and password are required." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  const d = db();
  if (d.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const user = {
    id: uid("u"),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    passwordHash: await hashPassword(password),
    country: String(country).trim(),
    telegram: telegram?.trim()
      ? String(telegram).trim().replace(/^@/, "")
      : undefined,
    avatarColor: COLORS[d.users.length % COLORS.length],
    role: "USER" as const,
    status: "ACTIVE" as const,
    verified: false,
    rating: 0,
    ratingCount: 0,
    createdAt: Date.now(),
  };
  d.users.push(user);
  persist();

  const token = await signSession(user.id, user.role);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", sessionCookie(token));
  return res;
}
