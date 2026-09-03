import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getSessionForReq } from "@/lib/tg-accounts";
export async function GET(req: NextRequest) {
  const s = getSessionForReq(req);
  if (!s) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  const client = getClient(s);
  try {
    await client.connect();
    const dialogs: any[] = await client.getDialogs({});
    let me: any = null;
    try { me = await client.getMe(); } catch {}

    const items = await Promise.all(dialogs
      .filter((d: any) => {
        const e = d.entity;
        if (!e) return false;
        if (d.isUser) return false;
        if (e.className === "User") return false;
        if (e.bot === true) return false;
        if (e.className === "Chat") return true;
        if (e.className === "Channel" && e.megagroup === true) return true;
        if (d.isGroup) return true;
        return false;
      })
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

        return { id: String(e?.id ?? d.id), title: d.title || e?.title || "Unknown", type, privacy, isSupergroup: e?.megagroup === true, username: e?.username || "", members: e?.participantsCount ?? d?.entity?.participantsCount ?? 0, allowed, lastUsed: "-" };
      }));
    await client.disconnect();
    return NextResponse.json({ dialogs: items });
  } catch (e: any) { try { await client.disconnect(); } catch {} return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 }); }
}
