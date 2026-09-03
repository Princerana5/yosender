import { NextRequest, NextResponse } from "next/server";
import { verifyToken, signToken } from "@/lib/auth";
import { getUsers, saveUsers } from "@/lib/db";

function getUid(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

export async function PATCH(req: NextRequest) {
  const uid = getUid(req);
  if (!uid) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { name, email, telegramUsername } = await req.json().catch(() => ({}));
  if (!name && !email && telegramUsername === undefined) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const users = getUsers();
  const idx = users.findIndex((u) => u.id === uid);
  if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (email) {
    const clean = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    if (users.some((u) => u.id !== uid && u.email.toLowerCase() === clean)) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    users[idx].email = clean;
  }
  if (name) {
    const cleanName = String(name).trim();
    if (cleanName.length < 2) return NextResponse.json({ error: "Name too short" }, { status: 400 });
    if (cleanName.length > 50) return NextResponse.json({ error: "Name too long" }, { status: 400 });
    users[idx].name = cleanName;
  }
  if (telegramUsername !== undefined) {
    const tg = String(telegramUsername || "").trim().replace(/^@/, "");
    if (tg && !/^[a-zA-Z0-9_]{3,32}$/.test(tg)) return NextResponse.json({ error: "Invalid Telegram username (3-32 letters, numbers, _)" }, { status: 400 });
    (users[idx] as any).telegramUsername = tg || undefined;
  }

  saveUsers(users);
  const u: any = users[idx];
  const token = signToken({ id: u.id, email: u.email, name: u.name, telegramUsername: u.telegramUsername });
  const res = NextResponse.json({ ok: true, user: { id: u.id, name: u.name, email: u.email, telegramUsername: u.telegramUsername } });
  res.cookies.set("auth_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}

export async function DELETE(req: NextRequest) {
  const uid = getUid(req);
  if (!uid) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === uid);
  if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });
  users.splice(idx, 1);
  saveUsers(users);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("auth_token", "", { maxAge: 0, path: "/" });
  res.cookies.set("tg_session", "", { maxAge: 0, path: "/" });
  res.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
  return res;
}
