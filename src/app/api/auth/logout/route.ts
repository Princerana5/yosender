import { NextResponse } from "next/server";
export async function POST() {
  const r = NextResponse.json({ ok: true });
  r.cookies.set("auth_token", "", { maxAge: 0, path: "/" });
  r.cookies.set("tg_session", "", { maxAge: 0, path: "/" });
  r.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
  return r;
}
