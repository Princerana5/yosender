import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";
import { getSessionForReqWithAccount } from "@/lib/tg-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Join batches are long single requests — need minutes on self-hosted Next
// (PM2/nginx path, already 360s). Serverless platforms clamp to their ceiling.
export const maxDuration = 300;

// Adaptive pacing: small batches join fast (~4s apart — feels instant, still
// 3x safer than the old 1.5s that caused Flood wait 70s). Only large batches
// slow down, since that's where Telegram's burst radar actually bites.
// Public links cost 2 calls (resolve + join), private invites cost 1.
const JOIN_PAUSE_FAST_MS = 4000;
const JOIN_PAUSE_SLOW_MS = 8000;
const FAST_JOIN_COUNT = 5;
// Telegram's documented per-account ceiling for supergroups/channels.
// (Kept module-private: Next route files may only export HTTP handlers +
// known config keys, anything else breaks the production type-check.)
const TG_MAX_GROUPS_PER_ACCOUNT = 500;

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

  // Join ONLY from the chosen account — never silently fall back to active
  // (that joined account B's links from account A after an account switch).
  if (accountId != null) {
    const { getAccountForReqWithAccount } = await import("@/lib/tg-accounts");
    if (!getAccountForReqWithAccount(req, String(accountId))) {
      return NextResponse.json({ error: "Account not found — refresh accounts and try again" }, { status: 404 });
    }
  }
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
    // Adaptive pacing: first few joins go fast, then ease off. When a
    // FLOOD_WAIT arrives anyway, honor it exactly (server-side sleep) and
    // continue the queue — never abandon links.
    let joinsDone = 0;
    const pacedPause = async () => {
      joinsDone++;
      // links.length is the chunk the UI sent (3). Fast for short queues,
      // slow lane only kicks in past FAST_JOIN_COUNT in one request.
      const slow = links.length > FAST_JOIN_COUNT && joinsDone >= FAST_JOIN_COUNT;
      await new Promise(r => setTimeout(r, slow ? JOIN_PAUSE_SLOW_MS : JOIN_PAUSE_FAST_MS));
    };
    const floodSleep = async (sec: number) => {
      // Honor Telegram's exact wait, capped so one bad link can't stall the
      // route past maxDuration. Remainder stays queued for the UI's retry.
      const capped = Math.min(Math.max(sec, 1), 120);
      await new Promise(r => setTimeout(r, (capped + 2) * 1000));
      return sec > capped ? sec - capped : 0;
    };
    let pendingFlood = 0;
    for (const raw of links) {
      const link = String(raw).trim();
      if (!link) continue;
      // Normalize every accepted input into something Telegram can resolve:
      // full URLs (https://t.me/x, t.me/x), @usernames, and bare usernames.
      // Anything else (random website URLs, locked placeholders) is skipped
      // silently — the UI already filters, so don't spam Failed rows for them.
      let normalized = link
        .replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i, "")
        .replace(/^t\.me\//i, "")
        .replace(/^@/, "")
        .split(/[?\s]/)[0]
        .replace(/\/$/, "");
      if (!normalized || /^(locked|undefined|null)$/i.test(normalized)) continue;
      // Skip internal / malformed links the catalog sometimes stores
      // (t.me/c/... needs an invite hash and can never be joined directly).
      if (/^c(\/|$)/i.test(normalized)) {
        results.push({ link, status: "Failed", error: "Private group — needs an invite link" });
        continue;
      }
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
            if (m.includes("FLOOD_WAIT") || (m === "FLOOD" && (e as any)?.code === 420)) {
              const sec = Number(m.match(/(\d+)/)?.[1] || (e as any)?.seconds || 60);
              const rest = await floodSleep(sec);
              if (rest > 0) {
                pendingFlood = rest;
                results.push({ link, status: "RateLimited", retryAfter: rest, error: `Flood wait ${sec}s — auto-retrying shortly` });
                continue;
              }
              // Wait honored — retry this link once before moving on.
              try {
                const entity: any = await client.getEntity(normalized as any);
                await (client as any).invoke(new Api.channels.JoinChannel({ channel: entity } as any));
                results.push({ link, status: "Joined" });
              } catch (e2: any) {
                const m2 = e2.errorMessage || e2.message || String(e2);
                if (m2.includes("FLOOD_WAIT")) {
                  const s2 = Number(m2.match(/(\d+)/)?.[1] || 60);
                  pendingFlood = s2;
                  results.push({ link, status: "RateLimited", retryAfter: s2, error: `Flood wait ${s2}s — auto-retrying shortly` });
                } else {
                  results.push({ link, status: "Failed", error: m2.slice(0, 120) });
                }
              }
              continue;
            }
            results.push({ link, status: "Failed", error: m.slice(0, 120) });
          }
        }
        // Polite pause between joins — Telegram flags rapid join bursts.
        await pacedPause();
      } catch (e: any) {
        const m = e.errorMessage || e.message || String(e);
        if (m.includes("FLOOD_WAIT") || (m === "FLOOD" && (e as any)?.code === 420)) {
          const sec = Number(m.match(/(\d+)/)?.[1] || (e as any)?.seconds || 60);
          const rest = await floodSleep(sec);
          if (rest > 0) {
            pendingFlood = rest;
            results.push({ link, status: "RateLimited", retryAfter: rest, error: `Flood wait ${sec}s — auto-retrying shortly` });
          } else {
            // Wait honored — retry this link once before moving on.
            try {
              if (/^(\+|joinchat\/)/i.test(normalized)) {
                const hash = normalized.replace(/^joinchat\//i, "").replace(/^\+/, "");
                await (client as any).invoke(new Api.messages.ImportChatInvite({ hash } as any));
              } else {
                const entity: any = await client.getEntity(normalized as any);
                await (client as any).invoke(new Api.channels.JoinChannel({ channel: entity } as any));
              }
              results.push({ link, status: "Joined" });
            } catch (e2: any) {
              const m2 = e2.errorMessage || e2.message || String(e2);
              if (m2.includes("FLOOD_WAIT")) {
                const s2 = Number(m2.match(/(\d+)/)?.[1] || 60);
                pendingFlood = s2;
                results.push({ link, status: "RateLimited", retryAfter: s2, error: `Flood wait ${s2}s — auto-retrying shortly` });
              } else if (m2.includes("INVITE_HASH_EXPIRED") || m2.includes("INVITE_HASH_INVALID")) {
                results.push({ link, status: "Failed", error: "Invite expired/invalid" });
              } else if (m2.includes("CHANNELS_TOO_MUCH")) {
                results.push({ link, status: "Failed", error: "Too many channels (500 max) — leave some first" });
              } else {
                results.push({ link, status: "Failed", error: m2.slice(0, 120) });
              }
            }
          }
        } else if (m.includes("INVITE_HASH_EXPIRED") || m.includes("INVITE_HASH_INVALID")) {
          results.push({ link, status: "Failed", error: "Invite expired/invalid" });
        } else if (m.includes("CHANNELS_TOO_MUCH")) {
          results.push({ link, status: "Failed", error: "Too many channels (500 max) — leave some first" });
        } else {
          results.push({ link, status: "Failed", error: m.slice(0, 120) });
        }
      }
    }
    await client.disconnect();
    return NextResponse.json({ results, joinPauseMs: JOIN_PAUSE_FAST_MS, maxGroupsPerAccount: TG_MAX_GROUPS_PER_ACCOUNT, pendingFlood });
  } catch (e: any) {
    try { await client.disconnect(); } catch {}
    return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 });
  }
}
