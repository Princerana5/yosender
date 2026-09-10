/**
 * Group harvest — shared helper that turns a user's Telegram dialogs
 * (from any of their connected accounts) into Browse-catalog seeds.
 *
 * Each connected Telegram account contributes its own groups, so a client
 * logging in with 1 account or 5 gets every group from every account
 * collected automatically — names + member counts included, invite links
 * derived from public usernames.
 *
 * Private groups have no public link: the harvest records them with a
 * placeholder `t.me/c/<id>` raw link. normalizeGroupLink lowercases that to
 * a stable dedup key, and the admin "Refresh Members" pass can still show
 * counts for them where Telegram allows preview.
 */

import { getAccounts } from "./db";
import { bulkUpsertGroupLinks, type GroupSeed } from "./groups-db";
import { getClient } from "./tg";

export type HarvestResult = {
  accountsChecked: number;
  dialogsSeen: number;
  seeds: number;
  newGroups: number;
  duplicates: number;
  invalid: number;
};

function seedFromDialog(d: any): GroupSeed | null {
  const e = d?.entity;
  if (!e) return null;
  if (d.isUser) return null;
  if (e.className === "User") return null;
  if (e.bot === true) return null;
  const isChat = e.className === "Chat";
  const isMega = e.className === "Channel" && e.megagroup === true;
  if (!isChat && !isMega && !d.isGroup) return null;

  const title = d.title || e.title || null;
  const username: string | null = e.username || null;
  const memberCount =
    typeof e.participantsCount === "number"
      ? e.participantsCount
      : typeof d?.entity?.participantsCount === "number"
        ? d.entity.participantsCount
        : null;
  // Send-permission snapshot from the dialog entity itself (same logic as
  // /api/telegram/dialogs): creator/admins can always post; otherwise the
  // default send ban decides. No extra MTProto calls — this rides the dialogs
  // fetch the harvest already performs.
  const sendAllowed =
    e?.creator === true || e?.adminRights
      ? true
      : e?.defaultBannedRights?.sendMessages === true
        ? false
        : null;

  if (username) {
    return {
      link: `https://t.me/${String(username).toLowerCase()}`,
      name: title,
      username: String(username).toLowerCase(),
      memberCount,
      sendAllowed,
    };
  }
  // Private group — no public link. Stable placeholder keyed by Telegram id.
  const id = e.id ?? d.id;
  if (id == null) return null;
  return {
    link: `https://t.me/c/${String(id).replace(/^-100/, "")}`,
    name: title,
    username: null,
    memberCount,
    sendAllowed,
  };
}

/**
 * Harvest dialogs from specific Telegram account ids (must belong to userId),
 * or from ALL of the user's connected accounts when accountIds is omitted.
 * Never throws — returns per-account tolerant results.
 */
export async function harvestUserGroups(opts: {
  userId: string;
  submittedByEmail: string;
  submittedByName: string;
  accountIds?: string[] | null;
}): Promise<HarvestResult> {
  const result: HarvestResult = {
    accountsChecked: 0,
    dialogsSeen: 0,
    seeds: 0,
    newGroups: 0,
    duplicates: 0,
    invalid: 0,
  };

  const owned = getAccounts().filter(
    (a) => a.userId === opts.userId && a.session
  );
  const wanted = Array.isArray(opts.accountIds) && opts.accountIds.length
    ? new Set(opts.accountIds.map(String))
    : null;
  const targets = wanted
    ? owned.filter((a) => wanted.has(String(a.id)))
    : owned;
  if (!targets.length) return result;

  const seeds: GroupSeed[] = [];

  for (const acc of targets) {
    const client = getClient(acc.session);
    try {
      await client.connect();
      result.accountsChecked++;
      let dialogs: any[] = [];
      try {
        dialogs = await client.getDialogs({});
      } catch {
        continue;
      } finally {
        try {
          await client.disconnect();
        } catch {}
      }
      result.dialogsSeen += dialogs.length;
      for (const d of dialogs) {
        try {
          const seed = seedFromDialog(d);
          if (seed) seeds.push(seed);
        } catch {}
      }
    } catch {
      try {
        await client.disconnect();
      } catch {}
    }
  }

  if (!seeds.length) return result;
  result.seeds = seeds.length;

  const r = bulkUpsertGroupLinks(seeds, {
    submittedBy: opts.userId,
    submittedByEmail: opts.submittedByEmail,
    submittedByName: opts.submittedByName,
    source: "user",
  });
  result.newGroups = r.newGroups;
  result.duplicates = r.duplicates;
  result.invalid = r.invalid;
  return result;
}
