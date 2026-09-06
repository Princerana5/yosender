import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getCampaigns, saveCampaigns } from "@/lib/db";
import { ensureRepeatInterval } from "@/lib/repeat-tick";
import { getActiveSubscription, campaignsTodayCount } from "@/lib/subscriptions";
import { getPlan, planAllows } from "@/lib/plans";
function uid(req: NextRequest) { const t = req.cookies.get("auth_token")?.value; const p = t ? verifyToken(t) : null; return (p as any)?.id || null; }
export async function GET(req: NextRequest) {
  ensureRepeatInterval();
  const id = uid(req); if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  return NextResponse.json({ campaigns: getCampaigns().filter(c => c.userId === id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)) });
}
export async function POST(req: NextRequest) {
  ensureRepeatInterval();
  const id = uid(req); if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json();
  // plan enforcement
  const sub = getActiveSubscription(id);
  const plan = sub ? getPlan(sub.planId) : null;
  if (!plan) return NextResponse.json({ error: "No active subscription — redeem a license key in Plans to activate." }, { status: 403 });
  const destCount = (body.destinations || []).length;
  const repeatMins = body.repeatEveryMins || body.delayMins || null;
  const isRepeating = body.status === "Repeating" && repeatMins;
  const check = planAllows(plan, destCount, isRepeating ? Number(repeatMins) : null);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });
  // daily campaign limit
  const todayCount = campaignsTodayCount(id);
  if (plan.campaignsPerDay !== Infinity && todayCount >= plan.campaignsPerDay) {
    return NextResponse.json({ error: `${plan.name} allows ${plan.campaignsPerDay} campaigns per day — you have used ${todayCount} today. Upgrade or try tomorrow.` }, { status: 429 });
  }
  const now = new Date().toISOString();
  const all = getCampaigns();
  let newId = String(body.id || "");
  if (!newId || all.some(x => x.id === newId && x.userId === id)) {
    try { newId = (globalThis.crypto as any)?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2,9)}`; } catch { newId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,9)}`; }
  }
  const everyMins = body.repeatEveryMins || body.delayMins || null;
  const isRep = body.status === "Repeating" && everyMins;
  const nextRunAt = isRep ? new Date(Date.now() + Number(everyMins) * 60 * 1000).toISOString() : null;
  const lastRunAt = isRep ? now : null;
  const c: any = { id: newId, userId: id, accountId: body.accountId||null, managed:false, name: body.name||"Untitled", message: body.message||"", destinations: body.destinations||[], delayMs: 1200, scheduledAt: body.scheduledAt||null, mode: "post" as const, status: body.status||"Draft", successful: body.successful||0, failed: body.failed||0, createdAt: now, logs: body.logs||[], repeatIntervalId: body.repeatIntervalId||null, repeatEveryMins: everyMins, delayMins: body.delayMins||null, imagePreview: body.imagePreview||null, nextRunAt, lastRunAt };
  all.unshift(c); saveCampaigns(all);
  return NextResponse.json({ campaign: c });
}
export async function PATCH(req: NextRequest) {
  ensureRepeatInterval();
  const id = uid(req); if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { patchId, patch } = await req.json();
  const all = getCampaigns(); const idx = all.findIndex(c=>c.id===String(patchId)&&c.userId===id);
  if(idx===-1) return NextResponse.json({error:"Not found"},{status:404});
  // if resuming to Repeating, enforce plan repeat limit
  if (patch.status === "Repeating") {
    const sub = getActiveSubscription(id);
    const plan = sub ? getPlan(sub.planId) : null;
    if (!plan) return NextResponse.json({ error: "No active subscription" }, { status: 403 });
    const mins = patch.repeatEveryMins || patch.delayMins || all[idx].repeatEveryMins || all[idx].delayMins || 15;
    if (Number(mins) < plan.minRepeatMins) return NextResponse.json({ error: `${plan.name} requires repeat ≥ ${plan.minRepeatMins} min` }, { status: 403 });
  }
  const prev = all[idx];
  const next: any = { ...prev, ...patch };
  // Server-authored progress always wins: when the sender loop writes logs +
  // counts to the row, a stale overwriting PATCH from the browser (e.g. an
  // old logs array, or 0/0 counts without logs) must not erase them.
  if ((prev.logs?.length || 0) > ((patch.logs as any[])?.length || 0) && patch.logs !== undefined) {
    next.logs = prev.logs;
    next.successful = prev.successful;
    next.failed = prev.failed;
  }
  if ((prev.logs?.length || 0) > 0 && ((patch.logs as any[])?.length || 0) === 0 && patch.successful === 0 && patch.failed === 0 && !patch.status) {
    next.logs = prev.logs;
    next.successful = prev.successful;
    next.failed = prev.failed;
  }
  if (patch.status === "Repeating" && prev.status !== "Repeating") {
    const mins = next.repeatEveryMins || next.delayMins || 15;
    next.nextRunAt = new Date(Date.now() + Number(mins) * 60 * 1000).toISOString();
    if (!next.lastRunAt) next.lastRunAt = new Date().toISOString();
  }
  all[idx] = next; saveCampaigns(all);
  return NextResponse.json({campaign: all[idx]});
}
