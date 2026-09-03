import { getCampaigns, saveCampaigns, getAccounts } from "./db";
import { getClient } from "./tg";

const g: any = globalThis as any;
let ticking = g.__tgm_ticking || false;
let intervalStarted = g.__tgm_repeat_interval_started || false;
// per-campaign lock — prevents same campaign sending twice concurrently (tick vs manual send race)
const sendingCampaigns: Set<string> = g.__tgm_sending_campaigns || (g.__tgm_sending_campaigns = new Set<string>());
// per-account lock — prevents 2 concurrent sends from same Telegram account (would look like duplicate)
const sendingAccounts: Set<string> = g.__tgm_sending_accounts || (g.__tgm_sending_accounts = new Set<string>());

function setTicking(v: boolean) { ticking = v; g.__tgm_ticking = v; }
function setIntervalStarted(v: boolean) { intervalStarted = v; g.__tgm_repeat_interval_started = v; }

async function sendForCampaign(campaign: any, accountSession: string) {
  const destinations: string[] = campaign.destinations || [];
  const message: string = campaign.message || "";
  const imagePreview: string | null = campaign.imagePreview || null;

  let imageBuffer: Buffer | null = null;
  if (imagePreview && imagePreview.startsWith("data:")) {
    try {
      const b64 = imagePreview.split(",")[1];
      imageBuffer = Buffer.from(b64, "base64");
      if (imageBuffer.length > 8 * 1024 * 1024) imageBuffer = null;
    } catch {}
  }

  const client = getClient(accountSession);
  await client.connect();
  const results: any[] = [];
  const normalizeDest = (s: string) => {
    let v = String(s).trim();
    v = v.replace(/^https?:\/\/(www\.)?t\.me\//i, "").replace(/^t\.me\//i, "").replace(/^@/, "");
    return v || String(s).trim();
  };
  for (const rawDest of destinations) {
    const destId = normalizeDest(rawDest);
    try {
      let entity: any = null;
      if (/^(\+|joinchat\/)/i.test(destId)) {
        try {
          const hash = destId.replace(/^joinchat\//i, "").replace(/^\+/, "");
          try { await (client as any).invoke(new (await import("telegram/tl")).Api.messages.CheckChatInvite({ hash } as any)); } catch {}
          try { await (client as any).invoke(new (await import("telegram/tl")).Api.messages.ImportChatInvite({ hash } as any)); } catch {}
        } catch {}
      }
      try { entity = await client.getEntity(destId as any); } catch {
        try { entity = await client.getEntity(rawDest as any); } catch {
          const dialogs: any[] = await client.getDialogs({});
          const m = dialogs.find((d: any) => String(d.entity?.id) === String(destId) || String(d.id) === String(destId) || String(d.entity?.username||"").toLowerCase()===destId.toLowerCase());
          entity = m?.entity;
        }
      }
      if (!entity) throw new Error("Group not found: " + rawDest);
      if (imageBuffer) {
        await client.sendFile(entity, { file: imageBuffer as any, caption: message || undefined, attributes: [] } as any);
      } else {
        await client.sendMessage(entity, { message });
      }
      results.push({ dest: destId, status: "Sent", time: new Date().toISOString() });
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e: any) {
      const m = e.errorMessage || e.message || String(e);
      if (m.includes("FLOOD_WAIT")) {
        const sec = Number(m.match(/(\d+)/)?.[1] || 30);
        results.push({ dest: destId, status: "RateLimited", time: new Date().toISOString(), error: `Flood wait ${sec}s` });
        await new Promise((r) => setTimeout(r, Math.min(sec, 10) * 1000));
      } else results.push({ dest: destId, status: "Failed", time: new Date().toISOString(), error: m });
    }
  }
  await client.disconnect();
  return results;
}

export function isAccountSending(accountId: string): boolean {
  return sendingAccounts.has(String(accountId));
}
export function acquireAccountSend(accountId: string): boolean {
  const k = String(accountId);
  if (sendingAccounts.has(k)) return false;
  sendingAccounts.add(k);
  return true;
}
export function releaseAccountSend(accountId: string) {
  sendingAccounts.delete(String(accountId));
}

export async function tickRepeatingCampaigns() {
  if (ticking) return { ran: 0, skipped: true };
  setTicking(true);
  try {
    const all = getCampaigns();
    const now = Date.now();
    let changed = false;

    // collect due campaigns first — then run them in parallel (per-account)
    const due: any[] = [];
    for (const c of all) {
      if (c.status !== "Repeating") continue;
      const everyMins = (c as any).repeatEveryMins || (c as any).delayMins || 15;
      const everyMs = everyMins * 60 * 1000;

      // hydrate nextRunAt if missing (server restart / old data)
      if (!(c as any).nextRunAt) {
        const last = (c as any).lastRunAt ? new Date((c as any).lastRunAt).getTime() : new Date(c.createdAt).getTime();
        (c as any).nextRunAt = new Date(last + everyMs).toISOString();
        changed = true;
      }

      const nextAt = new Date((c as any).nextRunAt).getTime();
      if (isNaN(nextAt) || nextAt > now) continue;

      // must have an account to send from — never fall back to "active"
      const accountId = (c as any).accountId;
      if (!accountId) continue;
      // skip if already sending (manual send race or another due campaign on same account)
      if (sendingCampaigns.has(String(c.id))) continue;
      if (sendingAccounts.has(String(accountId))) continue;
      const acc = getAccounts().find((a) => a.id === String(accountId) && a.userId === c.userId);
      if (!acc?.session) continue;

      due.push(c);
    }

    if (!due.length) {
      if (changed) saveCampaigns(all);
      return { ran: 0, skipped: false };
    }

    // reserve locks for all due campaigns before starting any send
    // (prevents same account being picked twice in this tick)
    const reserved: any[] = [];
    const seenAccounts = new Set<string>();
    for (const c of due) {
      const accId = String((c as any).accountId);
      if (seenAccounts.has(accId)) continue; // one send per account per tick — avoids Telegram flood
      if (sendingAccounts.has(accId) || sendingCampaigns.has(String(c.id))) continue;
      sendingCampaigns.add(String(c.id));
      sendingAccounts.add(accId);
      seenAccounts.add(accId);
      reserved.push(c);
    }

    // if we skipped some due to same-account collision, they'll fire next tick (10s later)
    const results = await Promise.all(reserved.map(async (c) => {
      const everyMins = (c as any).repeatEveryMins || (c as any).delayMins || 15;
      const everyMs = everyMins * 60 * 1000;
      const prevNextAt = new Date((c as any).nextRunAt).getTime();
      const accountId = String((c as any).accountId);
      const acc = getAccounts().find((a) => a.id === accountId && a.userId === c.userId);
      if (!acc?.session) return { c, skipped: true };
      try {
        const sendResults = await sendForCampaign(c, acc.session);
        const ok = sendResults.filter((r: any) => r.status === "Sent").length;
        const failed = sendResults.length - ok;
        c.successful = (c.successful || 0) + ok;
        c.failed = (c.failed || 0) + failed;
        const toAppend = sendResults.map((r: any) => ({ dest: r.dest, status: r.status, time: r.time, error: r.error || "" }));
        c.logs = [...(c.logs || []), ...toAppend];
        if (c.logs.length > 5000) c.logs = c.logs.slice(-5000);
        c.lastRunAt = new Date().toISOString();
        // FIX DRIFT: schedule from previous nextRunAt, not Date.now()
        // This keeps 1-min exactly 60s, not 60s + send duration
        let next = prevNextAt + everyMs;
        // if we fell behind (server was down), catch up to now+everyMs instead of tight-looping
        if (next <= Date.now()) next = Date.now() + everyMs;
        c.nextRunAt = new Date(next).toISOString();
        return { c, ok: true };
      } catch (e: any) {
        c.lastRunAt = new Date().toISOString();
        let next = prevNextAt + everyMs;
        if (next <= Date.now()) next = Date.now() + everyMs;
        c.nextRunAt = new Date(next).toISOString();
        return { c, ok: false, error: e.message };
      } finally {
        sendingCampaigns.delete(String(c.id));
        sendingAccounts.delete(accountId);
      }
    }));

    const ran = results.filter((r: any) => r.ok).length;
    // also count attempted (even if failed) as changed so nextRunAt advances
    if (reserved.length) changed = true;

    if (changed) saveCampaigns(all);
    return { ran, skipped: false };
  } finally {
    setTicking(false);
  }
}

export function ensureRepeatInterval() {
  if (intervalStarted) return;
  setIntervalStarted(true);
  // 10s tick — for 1-min schedule, 30s polling gives up to 30s jitter
  // 10s gives max 10s jitter, much closer to on-time
  const ms = 10 * 1000;
  setInterval(() => {
    tickRepeatingCampaigns().catch(() => {});
  }, ms);
  // also tick once shortly after startup
  setTimeout(() => tickRepeatingCampaigns().catch(() => {}), 3000);
}
