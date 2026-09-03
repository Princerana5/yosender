import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getSessionForReq } from "@/lib/tg-accounts";

export async function POST(req: NextRequest) {
  const session = getSessionForReq(req);
  if (!session) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  const { id, title } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Group id required" }, { status: 400 });

  const client = getClient(session);
  try {
    await client.connect();
    // Find the dialog entity by id
    const dialogs: any[] = await client.getDialogs({});
    const match = dialogs.find((d: any) => String(d.entity?.id) === String(id) || String(d.id) === String(id));
    const entity = match?.entity;
    if (!entity) {
      await client.disconnect();
      return NextResponse.json({ error: "Group not found — refresh and try again" }, { status: 404 });
    }
    // Leave: channels.LeaveChannel works for supergroups/channels, messages.DeleteChat for basic groups
    try {
      if (entity.className === "Channel") {
        await (client as any).invoke(new Api.channels.LeaveChannel({ channel: entity } as any));
      } else if (entity.className === "Chat") {
        await (client as any).invoke(new Api.messages.DeleteChat({ chatId: entity.id } as any));
      } else {
        // fallback
        await (client as any).invoke(new Api.channels.LeaveChannel({ channel: entity } as any));
      }
    } catch (e: any) {
      const m = e.errorMessage || e.message || String(e);
      // If already not participant, treat as success
      if (m.includes("USER_NOT_PARTICIPANT") || m.includes("CHAT_NOT_MODIFIED")) {
        await client.disconnect();
        return NextResponse.json({ ok: true, already: true });
      }
      throw e;
    }
    await client.disconnect();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try { await client.disconnect(); } catch {}
    const m = e.errorMessage || e.message || String(e);
    if (m.includes("FLOOD_WAIT")) {
      const sec = Number(m.match(/(\d+)/)?.[1] || 30);
      return NextResponse.json({ error: `Flood wait ${sec}s — try again later` }, { status: 429 });
    }
    return NextResponse.json({ error: m.slice(0, 200) }, { status: 500 });
  }
}
