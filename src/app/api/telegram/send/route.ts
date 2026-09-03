import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { getSessionForReq, getSessionForReqWithAccount, getUserIdFromReq } from "@/lib/tg-accounts";
import { ensureRepeatInterval, isAccountSending, acquireAccountSend, releaseAccountSend } from "@/lib/repeat-tick";
import { getActiveSubscription, campaignsTodayCount } from "@/lib/subscriptions";
import { getPlan, planAllows } from "@/lib/plans";

export async function POST(req: NextRequest) {
  ensureRepeatInterval();
  let accountId: string | null = null;
  let destinations: string[] = [];
  let message = "";
  let imageBuffer: Buffer | null = null;

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    destinations = JSON.parse((fd.get("destinations") as string) || "[]");
    message = (fd.get("message") as string) || "";
    accountId = (fd.get("accountId") as string) || null;
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
    if (accountId) releaseAccountSend(accountId);
    return NextResponse.json({ results });
  } catch (e: any) {
    try { await client.disconnect(); } catch {}
    if (accountId) releaseAccountSend(accountId);
    return NextResponse.json({ error: e.errorMessage || e.message || String(e) }, { status: 500 });
  }
}
