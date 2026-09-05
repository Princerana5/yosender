import { NextResponse } from "next/server";
import { db, persist } from "@/lib/db";
import { hashPassword, signSession, sessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const d = db();
  const user = d.users.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase()
  );
  if (!user) {
    return NextResponse.json({ error: "No account found with this email." }, { status: 401 });
  }
  if (user.status !== "ACTIVE") {
    return NextResponse.json(
      { error: `This account is ${user.status.toLowerCase()}. Contact support.` },
      { status: 403 }
    );
  }

  let ok: boolean;
  if (user.passwordHash.startsWith("plain:")) {
    // Seed account — transparent upgrade to bcrypt on first login
    ok = user.passwordHash === `plain:${password}`;
    if (ok) {
      user.passwordHash = await hashPassword(password);
      persist();
    }
  } else {
    ok = await verifyPassword(password, user.passwordHash);
  }
  if (!ok) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await signSession(user.id, user.role);
  const res = NextResponse.json({ ok: true, role: user.role });
  res.headers.set("Set-Cookie", sessionCookie(token));
  return res;
}
