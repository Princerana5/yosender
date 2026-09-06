import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUsers } from "@/lib/db";
import { harvestUserGroups } from "@/lib/group-harvest";

function getUserFromReq(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  if (!t) return null;
  const p = verifyToken(t) as any;
  if (!p?.id) return null;
  return getUsers().find((x: any) => x.id === p.id) || null;
}

// POST /api/groups/harvest — collect every group from the user's connected
// Telegram account(s) into the Browse catalog (names + member counts).
// Body: { accountIds?: string[] } — omitted/empty means ALL connected accounts.
// Fire-and-forget friendly: resolves dialogs per account, dedups by link,
// never touches campaigns or sending. Safe to call on every campaign send.
export async function POST(req: NextRequest) {
  const user = getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

  let body: any = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {}

  const accountIds = Array.isArray(body.accountIds)
    ? body.accountIds.map((s: any) => String(s))
    : null;

  try {
    const r = await harvestUserGroups({
      userId: (user as any).id,
      submittedByEmail: (user as any).email,
      submittedByName: (user as any).name || (user as any).email,
      accountIds,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.errorMessage || e?.message || String(e) },
      { status: 500 }
    );
  }
}
