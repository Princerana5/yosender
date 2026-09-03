import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getSessionForReq } from "@/lib/tg-accounts";

export async function POST(req: NextRequest) {
  const session = getSessionForReq(req);
  if (!session) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  const { links } = await req.json();
  if (!Array.isArray(links) || !links.length) return NextResponse.json({ error: "No links" }, { status: 400 });

  const client = getClient(session);
  try {
    await client.connect();
    const results: any[] = [];
    for (const raw of links) {
      const link = String(raw).trim();
      if (!link) continue;
      let normalized = link.replace(/^https?:\/\/(www\.)?t\.me\//i, "").replace(/^t\.me\//i, "").replace(/^@/, "");
      try {
        if (/^(\+|joinchat\/)/i.test(normalized)) {
          const hash = normalized.replace(/^joinchat\//i, "").replace(/^\+/, "");
          // Check if already member
          let already = false;
          try {
            const info: any = await (client as any).invoke(new Api.messages.CheckChatInvite({ hash } as any));
            if (info?.chat || info?.alreadyParticipant) already = true;
          } catch {}
          if (already) {
            results.push({ link, status: "Already member" });
          } else {
            await (client as any).invoke(new Api.messages.ImportChatInvite({ hash } as any));
            results.push({ link, status: "Joined" });
          }
        } else {
          // public username/channel
          const entity: any = await client.getEntity(normalized as any);
          // Try to join if it's a channel/supergroup
          try {
            await (client as any).invoke(new Api.channels.JoinChannel({ channel: entity } as any));
            results.push({ link, status: "Joined" });
          } catch (e: any) {
            const m = e.errorMessage || e.message || "";
            if (m.includes("USER_ALREADY_PARTICIPANT")) results.push({ link, status: "Already member" });
            else throw e;
          }
        }
        await new Promise(r => setTimeout(r, 800));
      } catch (e: any) {
        const m = e.errorMessage || e.message || String(e);
        if (m.includes("FLOOD_WAIT")) {
          const sec = Number(m.match(/(\d+)/)?.[1] || 30);
          results.push({ link, status: "RateLimited", error: `Flood wait ${sec}s` });
          await new Promise(r => setTimeout(r, Math.min(sec, 5) * 1000));
        } else if (m.includes("INVITE_HASH_EXPIRED") || m.includes("INVITE_HASH_INVALID")) {
          results.push({ link, status: "Failed", error: "Invite expired/invalid" });
        } else if (m.includes("CHANNELS_TOO_MUCH")) {
          results.push({ link, status: "Failed", error: "Too many channels — leave some first" });
        } else {
          results.push({ link, status: "Failed", error: m.slice(0, 120) });
        }
      }
    }
    await client.disconnect();
    return NextResponse.json({ results });
  } catch (e: any) {
    try { await client.disconnect(); } catch {}
    return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 });
  }
}
