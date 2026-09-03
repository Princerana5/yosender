import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUsers } from "@/lib/db";
export async function GET(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  if (!t) return NextResponse.json({ user: null });
  const p = verifyToken(t) as any;
  if (!p) return NextResponse.json({ user: null });
  // enrich with telegramUsername from DB (token may be stale)
  let telegramUsername: string | undefined;
  try { const u = getUsers().find(x => x.id === p.id); telegramUsername = (u as any)?.telegramUsername; } catch {}
  return NextResponse.json({ user: { id: p.id, name: p.name, email: p.email, telegramUsername: telegramUsername || p.telegramUsername } });
}
