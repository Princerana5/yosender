import { NextRequest, NextResponse } from "next/server";
import { requirePerm, getAdminId } from "@/lib/admin";
import { getAccounts } from "@/lib/db";
import { getGroups, saveGroups } from "@/lib/groups-db";
import { extractInviteHash, extractUsername } from "@/lib/group-links";
import { getClient } from "@/lib/tg";
import { Api } from "telegram/tl";

// POST /api/admin/groups/refresh-members — resolve live member counts for
// catalog groups via Telegram, then cache them on each GroupRecord.
// Body: { ids?: string[] } — omitted/empty means all active groups.
// Throttled to 1 request / ~1.2s to stay well under Telegram flood limits.
// Counts are public signals (visible in Telegram clients), so caching them
// for the browse catalog is safe; invite links themselves stay masked.
export async function POST(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;

  let body: any = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {}

  let groups = getGroups();
  let targets = groups.filter((g) => g.status === "active");
  if (Array.isArray(body.ids) && body.ids.length) {
    const set = new Set(body.ids.map(String));
    targets = groups.filter((g) => set.has(g.id));
  }
  if (!targets.length) {
    return NextResponse.json({ ok: true, updated: 0, failed: 0, message: "No groups to refresh" });
  }

  // Use any admin-owned connected Telegram account as the lookup session.
  // Prefer an account owned by this admin; fallback to first connected account.
  const adminId = getAdminId(req);
  const accounts = getAccounts().filter((a) => a.session);
  const session =
    accounts.find((a) => a.userId === adminId)?.session || accounts[0]?.session || null;
  if (!session) {
    return NextResponse.json(
      { error: "No connected Telegram account found — connect one in Accounts first, then refresh." },
      { status: 400 }
    );
  }

  const client = getClient(session);
  let updated = 0;
  let failed = 0;
  const errors: Array<{ id: string; link: string; error: string }> = [];

  try {
    await client.connect();
    for (const g of targets) {
      try {
        let count: number | null = null;
        const hash = extractInviteHash(g.normalized_link || g.group_link);
        if (hash) {
          // Private invite — resolves without joining; participantsCount may be
          // absent for groups we can't preview, then falls back to full entity.
          try {
            const info: any = await (client as any).invoke(
              new Api.messages.CheckChatInvite({ hash } as any)
            );
            const chat = info?.chat;
            count =
              chat?.participantsCount ??
              chat?.participants_count ??
              null;
          } catch {}
        } else {
          const username = extractUsername(g.normalized_link || g.group_link);
          const ref = username || (g.group_username ? String(g.group_username) : "");
          if (ref) {
            try {
              const entity: any = await client.getEntity(ref as any);
              count =
                entity?.participantsCount ??
                entity?.participants_count ??
                null;
              // channels API may omit it on the base entity — try full channel
              if (count == null && entity?.className === "Channel") {
                try {
                  const full: any = await (client as any).invoke(
                    new Api.channels.GetFullChannel({ channel: entity } as any)
                  );
                  const fc =
                    full?.fullChat?.participantsCount ??
                    full?.fullChat?.participants_count ??
                    null;
                  if (typeof fc === "number") count = fc;
                } catch {}
              }
            } catch {}
          }
        }
        if (typeof count === "number" && count >= 0) {
          g.member_count = count;
          g.members_updated_at = new Date().toISOString();
          g.updated_at = new Date().toISOString();
          updated++;
        } else {
          failed++;
          errors.push({ id: g.id, link: g.group_link, error: "Count unavailable" });
        }
      } catch (e: any) {
        failed++;
        const m = e?.errorMessage || e?.message || String(e);
        if (m.includes("FLOOD_WAIT")) {
          const sec = Math.min(Number(m.match(/(\d+)/)?.[1] || 30), 20);
          await new Promise((r) => setTimeout(r, sec * 1000));
        }
        errors.push({ id: g.id, link: g.group_link, error: m.slice(0, 120) });
      }
      // gentle throttle between lookups
      await new Promise((r) => setTimeout(r, 1200));
    }
    saveGroups(groups);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.errorMessage || e?.message || String(e) },
      { status: 500 }
    );
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }

  const totalMembers = getGroups()
    .filter((g) => g.status === "active" && typeof g.member_count === "number")
    .reduce((s, g) => s + (g.member_count || 0), 0);

  return NextResponse.json({
    ok: true,
    updated,
    failed,
    totalMembers,
    errors: errors.slice(0, 20),
  });
}
