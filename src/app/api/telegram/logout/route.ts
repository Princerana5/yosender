import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromReq, getActiveId } from "@/lib/tg-accounts";
import { getAccounts, saveAccounts, getRentals } from "@/lib/db";
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const uid = getUserIdFromReq(req);
  // If id provided and user logged in, remove just that account.
  // Active RENTALS are protected: the tg row is only hidden client-side
  // (server keeps it so the 24h rental still works on re-login), and the
  // X button for those rows calls DELETE /accounts instead — this path is
  // only for own non-rental disconnects.
  if (id && uid) {
    const all = getAccounts();
    const acc = all.find((a) => a.id === String(id) && a.userId === uid);
    if (acc && !(acc as any).isRental) {
      const idx = all.findIndex((a) => a.id === String(id) && a.userId === uid);
      if (idx !== -1) {
        all.splice(idx, 1);
        saveAccounts(all);
      }
    }
    const remaining = getAccounts().filter((a) => a.userId === uid && !(a as any).isRental);
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
  // Sidebar logout: clear the BROWSER session only (cookies). Do NOT delete:
  //  - own non-rental accounts (they reconnect next login via saved session)
  //  - rental accounts (must survive logout until their 24h expiry)
  // Client wipes visible state; server re-serves everything on next login.
  const r = NextResponse.json({ ok: true });
  r.cookies.set("tg_session", "", { maxAge: 0, path: "/" });
  r.cookies.set("tg_active_id", "", { maxAge: 0, path: "/" });
  // Touch rentals so expired ones clean up even on logout ping
  try { void getRentals(); } catch {}
  return r;
}
