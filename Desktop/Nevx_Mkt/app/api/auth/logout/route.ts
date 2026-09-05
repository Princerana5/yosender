import { NextResponse } from "next/server";
import { clearedCookie } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearedCookie());
  return res;
}
