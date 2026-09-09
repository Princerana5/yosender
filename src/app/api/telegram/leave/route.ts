import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getSessionForReqWithAccount } from "@/lib/tg-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Leave-all batches need minutes on self-hosted Next (PM2/nginx path).
export const maxDuration = 300;

async function withClient<T>(session: string, fn: (client: any) => Promise<T>): Promise<T> {
  const client = getClient(session);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try { await client.disconnect(); } catch {}
  }
}

export async function POST(req: NextRequest) {
  const { accountId, id, accessHash, kind } = await req.json().catch(() => ({}));
  // accountId present but not resolvable (deleted / other user) must NOT fall
  // back to the active session — that made "Leave all" hit the wrong account
  // and report success while nothing left. Fail loudly instead.
  if (accountId != null) {
    const { getAccountForReqWithAccount } = await import("@/lib/tg-accounts");
    if (!getAccountForReqWithAccount(req, String(accountId))) {
      return NextResponse.json({ error: "Account not found — refresh accounts and try again" }, { status: 404 });
    }
  }
  const session = getSessionForReqWithAccount(req, accountId != null ? String(accountId) : null);
  if (!session) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  if (!id) return NextResponse.json({ error: "Group id required" }, { status: 400 });

  // Fast path: leave with just (id, accessHash) — one MTProto call, no dialogs scan.
  // The UI now sends these straight from the groups list. Old clients that only
  // send { id } fall through to the slow path below.
  // IMPORTANT: do NOT treat USER_NOT_PARTICIPANT as success here. If the group
  // appeared in our dialogs list we WERE a participant — USER_NOT_PARTICIPANT
  // means the (id, accessHash) is stale/wrong (e.g. from another account). Fall
  // through to the slow path which re-resolves the entity from dialogs and tries
  // the real LeaveChannel on the live entity.
  if (kind === "channel" && accessHash) {
    try {
      await withClient(session, async (client) => {
        try {
          await client.invoke(new Api.channels.LeaveChannel({
            channel: new Api.InputChannel({
              channelId: BigInt(String(id)),
              accessHash: BigInt(String(accessHash)),
            } as any),
          } as any));
        } catch (e: any) {
          const m = e.errorMessage || e.message || String(e);
          // Only swallow CHAT_NOT_MODIFIED (already gone). USER_NOT_PARTICIPANT
          // means wrong session/hash — must fall through to slow path.
          if (m.includes("CHAT_NOT_MODIFIED")) return;
          if (m.includes("USER_NOT_PARTICIPANT") || m.includes("USER_NOT_MUTUAL_CONTACT")) throw e;
          throw e;
        }
      });
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      const m = e.errorMessage || e.message || String(e);
      if (m.includes("FLOOD_WAIT")) {
        const sec = Number(m.match(/(\d+)/)?.[1] || 30);
        return NextResponse.json({ error: `Flood wait ${sec}s — try again later` }, { status: 429 });
      }
      if (m.includes("CHANNEL_INVALID") || m.includes("CHANNEL_PRIVATE") || m.includes("USER_BANNED") || m.includes("USER_NOT_PARTICIPANT") || m.includes("USER_NOT_MUTUAL_CONTACT")) {
        // Stale identifiers or wrong session — fall through to the entity-based slow path
      } else {
        return NextResponse.json({ error: m.slice(0, 200) }, { status: 500 });
      }
    }
  }

  // Fast path for basic groups: one call, no dialogs scan.
  if (kind === "chat") {
    try {
      await withClient(session, async (client) => {
        try {
          await client.invoke(new Api.messages.DeleteChatUser({
            chatId: BigInt(String(id)),
            userId: new Api.InputUserSelf(),
          } as any));
        } catch (e: any) {
          const m = e.errorMessage || e.message || String(e);
          // Only swallow CHAT_NOT_MODIFIED and CHAT_INVALID (already gone/deleted).
          // USER_NOT_PARTICIPANT means wrong session/hash — fall through to slow path.
          if (m.includes("CHAT_NOT_MODIFIED") || m.includes("CHAT_INVALID")) return;
          if (m.includes("USER_NOT_PARTICIPANT") || m.includes("USER_NOT_MUTUAL_CONTACT") || m.includes("USER_KICKED")) throw e;
          throw e;
        }
      });
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      const m = e.errorMessage || e.message || String(e);
      if (m.includes("FLOOD_WAIT")) {
        const sec = Number(m.match(/(\d+)/)?.[1] || 30);
        return NextResponse.json({ error: `Flood wait ${sec}s — try again later` }, { status: 429 });
      }
      // Already gone (deleted/kicked) counts as left — never surface
      // these as red "Failed" rows in Leave-all.
      if (m.includes("USER_KICKED")) {
        return NextResponse.json({ ok: true, already: true });
      }
      // Stale/wrong-session identifiers — fall through to slow path.
      if (m.includes("USER_NOT_PARTICIPANT") || m.includes("USER_NOT_MUTUAL_CONTACT") || m.includes("CHAT_INVALID") || m.includes("CHANNEL_PRIVATE") || m.includes("CHANNEL_INVALID") || m.includes("USER_BANNED")) {
        // fall through
      } else {
        return NextResponse.json({ error: m.slice(0, 200) }, { status: 500 });
      }
    }
  }

  // Slow path (legacy clients without kind/accessHash): resolve entity via dialogs.
  // limit: undefined = ALL dialogs (default 100 would miss groups beyond the first page).
  try {
    return await withClient(session, async (client) => {
      const dialogs: any[] = await client.getDialogs({ limit: undefined });
      const candidates = dialogs.filter((d: any) => String(d.entity?.id) === String(id) || String(d.id) === String(id));
      // Prefer the entity whose type matches the UI's kind — a Chat id and a
      // Channel id can be numerically equal but are different entities.
      const match = kind === "channel"
        ? candidates.find((d: any) => d.entity?.className === "Channel") || candidates[0]
        : kind === "chat"
          ? candidates.find((d: any) => d.entity?.className === "Chat") || candidates[0]
          : candidates[0];
      const entity = match?.entity;
      if (!entity) {
        return NextResponse.json({ error: "Group not found — refresh and try again" }, { status: 404 });
      }
      try {
        if (entity.className === "Channel") {
          await (client as any).invoke(new Api.channels.LeaveChannel({ channel: entity } as any));
        } else if (entity.className === "Chat") {
          await (client as any).invoke(new Api.messages.DeleteChatUser({
            chatId: BigInt(String(entity.id)),
            userId: new Api.InputUserSelf(),
          } as any));
        } else {
          await (client as any).invoke(new Api.channels.LeaveChannel({ channel: entity } as any));
        }
      } catch (e: any) {
        const m = e.errorMessage || e.message || String(e);
        // Entity came from OUR dialogs but the leave says not-a-participant —
        // we're on the WRONG account session (UI/account mismatch). Surface as
        // Failed so the UI warns, instead of reporting "ok" and re-showing.
        if (m.includes("USER_NOT_PARTICIPANT") || m.includes("USER_NOT_MUTUAL_CONTACT")) {
          return NextResponse.json({ error: "Not a member of this group on the active account — switch to the account that joined it" }, { status: 409 });
        }
        if (m.includes("CHAT_NOT_MODIFIED")) {
          return NextResponse.json({ ok: true, already: true });
        }
        throw e;
      }
      return NextResponse.json({ ok: true });
    });
  } catch (e: any) {
    const m = e.errorMessage || e.message || String(e);
    if (m.includes("FLOOD_WAIT")) {
      const sec = Number(m.match(/(\d+)/)?.[1] || 30);
      return NextResponse.json({ error: `Flood wait ${sec}s — try again later` }, { status: 429 });
    }
    return NextResponse.json({ error: m.slice(0, 200) }, { status: 500 });
  }
}
