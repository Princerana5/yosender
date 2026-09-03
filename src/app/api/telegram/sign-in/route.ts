import { NextRequest, NextResponse } from "next/server";
import { pending, tgClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getAccounts, saveAccounts } from "@/lib/db";
import { getUserIdFromReq, MAX_TG_ACCOUNTS } from "@/lib/tg-accounts";
export async function POST(req: NextRequest) {
  const { phone, code, password, phoneCodeHash } = await req.json();
  if (!phone || !code) return NextResponse.json({ error: "phone and code required" }, { status: 400 });
  const tp = phone.trim().replace(/\s+/g, "");
  const tc = code.trim().replace(/\s+/g, "");
  let hash = phoneCodeHash || pending.get(phone.trim())?.phoneCodeHash || pending.get(tp)?.phoneCodeHash;
  if (!hash && pending.size === 1) hash = [...pending.values()][0].phoneCodeHash;
  if (!hash) return NextResponse.json({ error: "No code session found. Go back, tap Send Verification Code again, and verify within 30 seconds." }, { status: 400 });
  try {
    if (!tgClient.connected) await tgClient.connect();
    try { await tgClient.invoke(new Api.auth.SignIn({ phoneNumber: tp, phoneCodeHash: hash, phoneCode: tc })); } catch (e: any) {
      const m = e.errorMessage || e.message || String(e);
      if (m.includes("SESSION_PASSWORD_NEEDED")) {
        if (!password) return NextResponse.json({ needPassword: true });
        const pwdInfo: any = await tgClient.invoke(new Api.account.GetPassword());
        const { computeCheck } = await import("telegram/Password");
        await tgClient.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwdInfo, password) }));
      } else if (m.includes("PHONE_CODE_EXPIRED")) throw new Error("Telegram says code expired — the hash/code pair doesn't match. You're either reusing an old code or the server lost the hash. Try once more with a brand new code immediately.");
      else if (m.includes("PHONE_CODE_INVALID")) throw new Error("Invalid code. Use the latest code from Telegram app only.");
      else throw new Error(m);
    }
    const sessionString = (tgClient.session as any).save() as string;
    let me: any; try { me = await tgClient.getMe(); } catch { me = { username: tp }; }
    pending.clear();
    const username = me.username || "";
    const firstName = me.firstName || "";
    const lastName = me.lastName || "";
    const displayName = [firstName, lastName].filter(Boolean).join(" ") || username || tp;
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
    return res;
  } catch (e: any) { return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 }); }
}
