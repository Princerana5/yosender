import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getAccountForReqWithAccount } from "@/lib/tg-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Large group lists need minutes, not seconds, on self-hosted Next
// (PM2/nginx path); serverless platforms clamp to their own ceiling.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // accountId query param lets the UI ask for a SPECIFIC account's groups
  // (Browse joins from the chosen account, but dialogs used the cookie-active one).
  const accountId = new URL(req.url).searchParams.get("accountId");
  const acc = getAccountForReqWithAccount(req, accountId);
  // Explicit accountId that resolves to nothing (deleted / other user) must
  // NOT fall back to the active account — that served account B's groups as
  // account A's. Tell the UI to refresh its account list instead.
  if (accountId && !acc) return NextResponse.json({ error: "Account not found — refresh accounts and try again" }, { status: 404 });
  const s = acc?.session || null;
  if (!s) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  const client = getClient(s);
  try {
    await client.connect();
    // limit: undefined = fetch ALL dialogs (default 100 would silently drop groups).
    const dialogs: any[] = await client.getDialogs({ limit: undefined });
    let me: any = null;
    try { me = await client.getMe(); } catch {}

    const items: any[] = [];
    // Participant checks are N+1 MTProto calls — unbounded Promise.all over
    // hundreds of groups floods Telegram and ends in TIMEOUTs (the live
    // server symptom). Small batches keep it reliable.
    const groupDialogs = dialogs
      .filter((d: any) => {
        const e = d.entity;
        if (!e) return false;
        if (d.isUser) return false;
        if (e.className === "User") return false;
        if (e.bot === true) return false;
        // Skip chats the account already left / was removed from. Telegram
        // still returns them in getDialogs (left:true), so without this the
        // list shows ghost rows that reappear on every refresh after leaving.
        if ((e as any).left === true) return false;
        if ((e as any).kicked === true) return false;
        if ((e as any).deactivated === true) return false;
        if (e.className === "Chat") return true;
        if (e.className === "Channel" && e.megagroup === true) return true;
        if (d.isGroup) return true;
        return false;
      });
    const CONC = 8;
    for (let i = 0; i < groupDialogs.length; i += CONC) {
      const batch = groupDialogs.slice(i, i + CONC);
      const out = await Promise.all(batch
      .map(async (d: any) => {
        const e = d.entity;
        const type = "Group";
        const isPublic = !!e?.username;
        const privacy = isPublic ? "Public" : "Private";

        const isCreator = !!e?.creator;
        const hasAdminRights = !!e?.adminRights;
        const defaultBlocked = !!e?.defaultBannedRights?.sendMessages;
        let allowed: boolean;

        if (isCreator || hasAdminRights) {
          allowed = true;
        } else if (e?.className === "Channel") {
          // Supergroup — always verify participant to catch individual bans/restricts
          try {
            const p: any = await (client as any).invoke(new Api.channels.GetParticipant({ channel: e, participant: me as any } as any));
            const part = p?.participant;
            if (!part) allowed = !defaultBlocked;
            else if (part.className === "ChannelParticipantBanned") allowed = false;
            else if (part.bannedRights?.sendMessages) allowed = false;
            else if (part.className === "ChannelParticipantAdmin" || part.className === "ChannelParticipantCreator") allowed = true;
            else allowed = !defaultBlocked; // regular ChannelParticipant
          } catch {
            allowed = !defaultBlocked;
          }
        } else {
          allowed = !defaultBlocked;
        }

        return { id: String(e?.id ?? d.id), title: d.title || e?.title || "Unknown", type, privacy, isSupergroup: e?.megagroup === true, username: e?.username || "", members: e?.participantsCount ?? d?.entity?.participantsCount ?? 0, allowed, lastUsed: "-",
          // Leave fast-path identifiers: kind + accessHash let /leave skip the dialogs scan.
          kind: e?.className === "Channel" ? "channel" : e?.className === "Chat" ? "chat" : "unknown",
          accessHash: e?.accessHash != null ? String(e.accessHash) : "" };
      }));
      items.push(...out);
    }
    await client.disconnect();
    return NextResponse.json({ dialogs: items, accountId: (acc as any)?.id || null });
  } catch (e: any) { try { await client.disconnect(); } catch {} return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 }); }
}