import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromReq, getActiveId } from "@/lib/tg-accounts";
import { getAccounts, saveAccounts } from "@/lib/db";
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const uid = getUserIdFromReq(req);
  // If id provided and user logged in, remove just that account
  if (id && uid) {
    const all = getAccounts();
    const idx = all.findIndex((a) => a.id === String(id) && a.userId === uid);
    if (idx !== -1) {
      all.splice(idx, 1);
      saveAccounts(all);
    }
    const remaining = all.filter((a) => a.userId === uid);
    const r = NextResponse.json({ ok: true });
    const activeId = getActiveId(req);
    if (activeId === String(id)) {
      if (remaining[0]) {
        r.cookies.set("tg_active_id", remaining[0].id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
        r.cookies.set("tg_session", remaining[0].session, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
      } else {
        r.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
        r.cookies.set("tg_session", "", { maxAge: 0, path: "/" });
      }
    }
    return r;
  }
  // Legacy: clear active session only
  const r = NextResponse.json({ ok: true });
  r.cookies.set("tg_session", "", { maxAge: 0, path: "/" });
  // keep tg_active_id if multi-account — only clear if no accounts left
  if (uid) {
    const remaining = getAccounts().filter((a) => a.userId === uid);
    if (!remaining.length) r.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
  } else {
    r.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
  }
  return r;
}
