import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getSessionForReqWithAccount } from "@/lib/tg-accounts";

export async function POST(req: NextRequest) {
  const { links, accountId } = await req.json();
  if (!Array.isArray(links) || !links.length) return NextResponse.json({ error: "No links" }, { status: 400 });

  // Browse Groups catalog is joinable only with an active plan — joining from
  // the catalog without one would bypass premium (the gate the UI enforces).
  try {
    const { verifyToken } = await import("@/lib/auth");
    const { getUsers } = await import("@/lib/db");
    const { getActiveSubscription } = await import("@/lib/subscriptions");
    const t = req.cookies.get("auth_token")?.value;
    const pl = t ? (verifyToken(t) as any) : null;
    const u = pl?.id ? getUsers().find((x: any) => x.id === pl.id) : null;
    if (u && !getActiveSubscription((u as any).id)) {
      return NextResponse.json(
        { error: "Joining groups is a premium feature — activate Elite, Pro, Max+ or Luxe to join.", premiumRequired: true },
        { status: 403 }
      );
    }
  } catch {}

  // Join from the chosen account when provided, else the active account.
  const session = getSessionForReqWithAccount(req, accountId != null ? String(accountId) : null);
  if (!session) return NextResponse.json({ error: "Selected Telegram account not found or not connected" }, { status: 401 });

  // Auto-collect every submitted group link into the Groups CRM (fire-and-forget, never blocks join flow)
  try {
    const { verifyToken } = await import("@/lib/auth");
    const { getUsers } = await import("@/lib/db");
    const { bulkUpsertGroupLinks } = await import("@/lib/groups-db");
    const t = req.cookies.get("auth_token")?.value;
    const pl = t ? (verifyToken(t) as any) : null;
    if (pl?.id) {
      const u = getUsers().find((x: any) => x.id === pl.id);
      if (u) {
        const validLinks = (Array.isArray(links) ? links : []).map((s: any) => String(s || "").trim()).filter((s: string) => /t\.me\//i.test(s) || /^@[\w]{3,}/.test(s));
        if (validLinks.length) bulkUpsertGroupLinks(validLinks, { submittedBy: (u as any).id, submittedByEmail: (u as any).email, submittedByName: (u as any).name || (u as any).email, source: "user" });
      }
    }
  } catch {}

  const client = getClient(session);
  try {
    await client.connect();
    const results: any[] = [];
    for (const raw of links) {
      const link = String(raw).trim();
      if (!link) continue;
      // Fast-reject anything that isn't a Telegram invite — no API call, no wait.
      // (e.g. random website URLs pasted by mistake, masked "locked" placeholders)
      if (!/(^|\.)t\.me\//i.test(link) && !/^@[\w]{3,}/.test(link) && !/^[\w]{3,32}$/.test(link)) {
        results.push({ link, status: "Failed", error: "Not a Telegram invite link" });
        continue;
      }
      let normalized = link.replace(/^https?:\/\/(www\.)?t\.me\//i, "").replace(/^t\.me\//i, "").replace(/^@/, "");
      try {
        if (/^(\+|joinchat\/)/i.test(normalized)) {
          const hash = normalized.replace(/^joinchat\//i, "").replace(/^\+/, "");
          // Single call: import directly, treat "already a member" as success.
          // (The old extra CheckChatInvite call doubled the time per private link.)
          try {
            await (client as any).invoke(new Api.messages.ImportChatInvite({ hash } as any));
            results.push({ link, status: "Joined" });
          } catch (e: any) {
            const m = e.errorMessage || e.message || "";
            if (m.includes("USER_ALREADY_PARTICIPANT") || m.includes("USER_ALREADY_INVITED")) {
              results.push({ link, status: "Already member" });
            } else {
              throw e;
            }
          }
        } else {
          // public username/channel — resolve + join in one call path.
          // getEntity caches on repeat joins of the same username batch.
          try {
            const entity: any = await client.getEntity(normalized as any);
            try {
              await (client as any).invoke(new Api.channels.JoinChannel({ channel: entity } as any));
              results.push({ link, status: "Joined" });
            } catch (e: any) {
              const m = e.errorMessage || e.message || "";
              if (m.includes("USER_ALREADY_PARTICIPANT")) results.push({ link, status: "Already member" });
              else if (m.includes("CHANNEL_PRIVATE") || m.includes("USERNAME_NOT_OCCUPIED") || m.includes("USERNAME_INVALID")) {
                results.push({ link, status: "Failed", error: "Group not found or private" });
              } else throw e;
            }
          } catch (e: any) {
            const m = e.errorMessage || e.message || String(e);
            results.push({ link, status: "Failed", error: m.slice(0, 120) });
          }
        }
        // No delay between successful joins — keep the batch moving.
        // Rate limits still surface as RateLimited results per link.
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
