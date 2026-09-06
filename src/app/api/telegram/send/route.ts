import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { getCampaigns, saveCampaigns } from "@/lib/db";
import { getSessionForReq, getSessionForReqWithAccount, getUserIdFromReq } from "@/lib/tg-accounts";
import { ensureRepeatInterval, isAccountSending, acquireAccountSend, releaseAccountSend } from "@/lib/repeat-tick";
import { getActiveSubscription, campaignsTodayCount } from "@/lib/subscriptions";
import { getPlan, planAllows } from "@/lib/plans";

// Long campaigns need minutes, not seconds. Self-hosted Next honors this
// (PM2/nginx path); serverless platforms clamp to their own ceiling, which
// is fine — progress is persisted per destination, so any cutoff is safe.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  ensureRepeatInterval();
  let accountId: string | null = null;
  let campaignId: string | null = null;
  let destinations: string[] = [];
  let message = "";
  let imageBuffer: Buffer | null = null;

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    destinations = JSON.parse((fd.get("destinations") as string) || "[]");
    message = (fd.get("message") as string) || "";
    accountId = (fd.get("accountId") as string) || null;
    campaignId = (fd.get("campaignId") as string) || null;
    const file = fd.get("image") as File | null;
    if (file && file.size > 0) {
      if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Image too large (max 8MB)" }, { status: 400 });
      imageBuffer = Buffer.from(await file.arrayBuffer());
    }
  } else {
    const j = await req.json();
    destinations = j.destinations || [];
    message = j.message || "";
    accountId = j.accountId || null;
    campaignId = j.campaignId || null;
  }
  if (!destinations?.length) return NextResponse.json({ error: "Add at least one group" }, { status: 400 });
  // plan enforcement for send
  const uidSend = getUserIdFromReq(req);
  if (!uidSend) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const subSend = getActiveSubscription(uidSend);
  const planSend = subSend ? getPlan(subSend.planId) : null;
  if (!planSend) return NextResponse.json({ error: "No active subscription — redeem a license key in Plans." }, { status: 403 });
  if (destinations.length > planSend.groupsPerCampaign) return NextResponse.json({ error: `${planSend.name} allows max ${planSend.groupsPerCampaign} groups per send (you selected ${destinations.length}). Upgrade to increase limit.` }, { status: 403 });
  // also enforce global max for safety
  const hardMax = planSend.groupsPerCampaign >= 10000 ? 15000 : planSend.groupsPerCampaign;
  if (destinations.length > hardMax) return NextResponse.json({ error: `Max ${hardMax} destinations per send` }, { status: 400 });
  if (!message?.trim() && !imageBuffer) return NextResponse.json({ error: "Message text or image required" }, { status: 400 });

  // IMPORTANT: if accountId is provided, send ONLY from that account — never fall back to active
  let session: string | null = null;
  if (accountId) {
    session = getSessionForReqWithAccount(req, accountId);
    if (!session) return NextResponse.json({ error: "Selected Telegram account not found or not connected" }, { status: 400 });
  } else {
    session = getSessionForReq(req);
  }
  if (!session) return NextResponse.json({ error: "Not connected" }, { status: 401 });

  // prevent duplicate sends from same Telegram account at the same time
  // (e.g. user double-clicks Start, or repeat tick fires while manual send is in-flight)
  if (accountId && isAccountSending(accountId)) {
    return NextResponse.json({ error: "This Telegram account is already sending — please wait for it to finish" }, { status: 429 });
  }
  if (accountId && !acquireAccountSend(accountId)) {
    return NextResponse.json({ error: "This Telegram account is already sending — please wait for it to finish" }, { status: 429 });
  }

  // If this send belongs to a campaign, skip destinations that already have
  // a log row (previous attempt sent them but the browser never got the
  // response — refresh, closed tab, timeout). Retries never double-send.
  if (campaignId) {
    try {
      const all = getCampaigns();
      const c = all.find((x: any) => x.id === String(campaignId) && x.userId === uidSend);
      if (c) {
        const claimed = new Set(((c as any).claimedDests || []) as string[]);
        const logged = new Set(((c.logs || []) as any[]).map((l: any) => String(l.dest ?? l.destId ?? "")));
        const fresh: string[] = [];
        for (const d of destinations) {
          if (logged.has(String(d))) continue;
          fresh.push(d);
        }
        (c as any).claimedDests = [...claimed, ...fresh.filter((d) => !claimed.has(d))];
        if (!c.accountId && accountId) c.accountId = accountId;
        if (c.status === "Draft") c.status = "Running";
        saveCampaigns(all);
        destinations = fresh;
        if (!destinations.length) {
          return NextResponse.json({ results: [], resumed: true, note: "All destinations already sent or in-flight — nothing to do." });
        }
      }
    } catch {}
  }

  // Record progress to the campaign row after EVERY destination, so the
  // dashboard / Delivery Logs update live and survive timeouts, refreshes
  // and closed tabs. Runs at most one JSON read+write per destination.
  const saveBatchProgress = (batchResults: any[]) => {
    if (!campaignId) return;
    try {
      const allNow = getCampaigns();
      const c = allNow.find((x: any) => x.id === String(campaignId) && x.userId === uidSend);
      if (!c) return;
      const toAppend = batchResults.map((r: any) => ({ dest: r.dest, status: r.status, time: r.time, error: r.error || "" }));
      c.logs = [...(c.logs || []), ...toAppend];
      const ok = (c.logs as any[]).filter((l: any) => l.status === "Sent").length;
      c.successful = ok;
      c.failed = (c.logs as any[]).length - ok;
      saveCampaigns(allNow);
    } catch {}
  };
  const stopRequested = () => {
    if (!campaignId) return false;
    try {
      const c = getCampaigns().find((x: any) => x.id === String(campaignId) && x.userId === uidSend);
      return c?.status === "Paused" || c?.status === "Failed" || c?.status === "Completed";
    } catch { return false; }
  };

  const client = getClient(session);
  try {
    await client.connect();
    const results: any[] = [];
    const normalizeDest = (s: string) => {
      let v = String(s).trim();
      v = v.replace(/^https?:\/\/(www\.)?t\.me\//i, "").replace(/^t\.me\//i, "").replace(/^@/, "");
      return v || String(s).trim();
    };
    for (const rawDest of destinations) {
      // User pressed Pause/Cancel mid-send — stop immediately. Everything
      // sent so far is already persisted via saveBatchProgress().
      if (stopRequested()) break;
      const destId = normalizeDest(rawDest);
      let entry: any;
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

        entry = { dest: String(rawDest), status: "Sent", time: new Date().toISOString() };
        results.push(entry);
        await new Promise((r) => setTimeout(r, 1200));
      } catch (e: any) {
        const m = e.errorMessage || e.message || String(e);
        if (m.includes("FLOOD_WAIT")) {
          const sec = Number(m.match(/(\d+)/)?.[1] || 30);
          entry = { dest: String(rawDest), status: "RateLimited", time: new Date().toISOString(), error: `Flood wait ${sec}s` };
          results.push(entry);
          await new Promise((r) => setTimeout(r, Math.min(sec, 10) * 1000));
        } else {
          entry = { dest: String(rawDest), status: "Failed", time: new Date().toISOString(), error: m };
          results.push(entry);
        }
      }
      // Persist every destination immediately — dashboard + logs stay
      // correct even if the browser disconnects mid-campaign.
      saveBatchProgress([entry]);
    }
    await client.disconnect();
    if (accountId) releaseAccountSend(accountId);
    // Final status: only mark Completed/Failed when every destination has a
    // log row AND this send wasn't stop-signalled mid-way. Never touch
    // Repeating campaigns — the repeat tick owns their lifecycle.
    if (campaignId && !stopRequested()) {
      try {
        const allDone = getCampaigns();
        const cd = allDone.find((x: any) => x.id === String(campaignId) && x.userId === uidSend);
        if (cd && cd.status !== "Repeating" && ((cd.logs || []).length >= (cd.destinations || []).length)) {
          const okFinal = (cd.logs as any[]).filter((l: any) => l.status === "Sent").length;
          cd.successful = okFinal;
          cd.failed = (cd.logs as any[]).length - okFinal;
          cd.status = okFinal > 0 || (cd.destinations || []).length === 0 ? "Completed" : "Failed";
          saveCampaigns(allDone);
        }
      } catch {}
    }

    // Auto-harvest: every group on the sender account lands in the Browse
    // catalog (names + counts). Fire-and-forget — never blocks the response.
    try {
      const { harvestUserGroups } = await import("@/lib/group-harvest");
      const { getUsers } = await import("@/lib/db");
      const u = getUsers().find((x: any) => x.id === uidSend);
      if (u) {
        harvestUserGroups({
          userId: uidSend,
          submittedByEmail: (u as any).email,
          submittedByName: (u as any).name || (u as any).email,
          accountIds: accountId ? [String(accountId)] : null,
        }).catch(() => {});
      }
    } catch {}

    return NextResponse.json({ results });
  } catch (e: any) {
    try { await client.disconnect(); } catch {}
    if (accountId) releaseAccountSend(accountId);
    return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 });
  }
}
