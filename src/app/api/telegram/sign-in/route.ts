import { NextRequest, NextResponse } from "next/server";
import { verifyLoginCode } from "@/lib/tg-login";
import { getAccounts, saveAccounts } from "@/lib/db";
import { getUserIdFromReq, MAX_TG_ACCOUNTS } from "@/lib/tg-accounts";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, code, password, phoneCodeHash, dcId } = await req.json();
  if (!phone || !code) return NextResponse.json({ error: "phone and code required" }, { status: 400 });
  const tp = phone.trim().replace(/\s+/g, "");
  try {
    let profile;
    try {
      profile = await verifyLoginCode({ phone, code, password, phoneCodeHash, dcId });
    } catch (e: any) {
      if ((e as any)?.needPassword) return NextResponse.json({ needPassword: true });
      const m = e?.errorMessage || e?.message || String(e);
      return NextResponse.json({ error: m }, { status: m.includes("expired") || m.includes("Invalid code") ? 400 : 500 });
    }
    const { session: sessionString, username, firstName, lastName, displayName } = {
      ...profile,
      displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.username || tp,
    };
    // If logged in via email, persist as a multi-account (up to MAX_TG_ACCOUNTS)
    const uid = getUserIdFromReq(req);
    let accountId: string | null = null;
    if (uid) {
      const all = getAccounts();
      const mine = all.filter((a) => a.userId === uid);
      const existingIdx = all.findIndex((a) => a.userId === uid && a.phone === tp);
      if (existingIdx !== -1) {
        all[existingIdx].session = sessionString;
        all[existingIdx].username = username;
        all[existingIdx].displayName = displayName;
        all[existingIdx].firstName = firstName;
        all[existingIdx].status = "connected";
        accountId = all[existingIdx].id;
        saveAccounts(all);
      } else {
        if (mine.length >= MAX_TG_ACCOUNTS) {
          const res = NextResponse.json({ error: `Limit reached — you can connect up to ${MAX_TG_ACCOUNTS} Telegram accounts per email. Remove one first.` }, { status: 400 });
          // still set legacy cookie so current session works
          res.cookies.set("tg_session", sessionString, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
          return res;
        }
        const acc = { id: (globalThis.crypto as any)?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2,9)}`, userId: uid, phone: tp, username, displayName, firstName, session: sessionString, status: "connected", createdAt: new Date().toISOString() };
        accountId = acc.id;
        all.push(acc);
        saveAccounts(all);
      }
    }
    const res = NextResponse.json({ ok: true, username, firstName, lastName, displayName, phone: tp, accountId });
    res.cookies.set("tg_session", sessionString, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    if (accountId) res.cookies.set("tg_active_id", accountId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });

    // Auto-harvest: the just-connected account's groups land in the Browse
    // catalog (names + counts). Fire-and-forget — never blocks login.
    try {
      if (uid && accountId) {
        const { harvestUserGroups } = await import("@/lib/group-harvest");
        const { getUsers } = await import("@/lib/db");
        const u = getUsers().find((x: any) => x.id === uid);
        if (u) {
          harvestUserGroups({
            userId: uid,
            submittedByEmail: (u as any).email,
            submittedByName: (u as any).name || (u as any).email,
            accountIds: [String(accountId)],
          }).catch(() => {});
        }
      }
    } catch {}

    return res;
  } catch (e: any) { return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 }); }
}
