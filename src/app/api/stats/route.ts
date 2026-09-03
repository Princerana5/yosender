import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getCampaigns, getAccounts } from "@/lib/db";
import { ensureRepeatInterval } from "@/lib/repeat-tick";
import { cookies } from "next/headers";

export async function GET() {
  ensureRepeatInterval();
  const all = getCampaigns();
  const totalCampaigns = all.length;
  const totalSent = all.reduce((a, c) => a + (c.successful || 0), 0);
  const totalFailed = all.reduce((a, c) => a + (c.failed || 0), 0);
  const totalDestinations = all.reduce((a, c) => a + (c.destinations?.length || 0), 0);
  const running = all.filter((c) => c.status === "Running" || c.status === "Repeating").length;
  const isToday = (iso: string) => {
    try { const d = new Date(iso); const n = new Date(); return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate(); } catch { return false; }
  };
  const todayList = all.filter(c => isToday(c.createdAt));
  let todaySent = 0;
  let todayGroupsSet = new Set<string>();
  for (const c of all) {
    const logs: any[] = (c as any).logs || [];
    const succ = c.successful || 0;
    if (logs.length && logs.length >= succ && succ > 0) {
      for (const l of logs) {
        if (l.status === "Sent" && l.time && isToday(l.time)) {
          todaySent++;
          if (l.dest) todayGroupsSet.add(String(l.dest));
        }
      }
    } else if (isToday(c.createdAt)) {
      todaySent += succ;
      for (const d of c.destinations || []) todayGroupsSet.add(String(d));
      for (const l of logs) {
        if (l.status === "Sent" && l.time && isToday(l.time) && !isToday(c.createdAt)) {}
      }
    } else if (logs.length) {
      for (const l of logs) {
        if (l.status === "Sent" && l.time && isToday(l.time)) {
          todaySent++;
          if (l.dest) todayGroupsSet.add(String(l.dest));
        }
      }
    }
  }
  const todayCampaigns = todayList.length;
  const todayDestinations = todayList.reduce((a, c) => a + (c.destinations?.length || 0), 0);
  const todayGroups = todayGroupsSet.size || new Set(todayList.flatMap(c => c.destinations || [])).size;

  let mine: any = null;
  let perAccount: any[] | null = null;
  try {
    const jar = await cookies();
    const t = jar.get("auth_token")?.value;
    const p = t ? verifyToken(t) : null;
    const uid = (p as any)?.id || null;
    if (uid) {
      const my = all.filter((c) => c.userId === uid);
      const myAccounts = getAccounts().filter((a) => a.userId === uid).sort((a,b)=> a.createdAt.localeCompare(b.createdAt));
      const legacy = my.filter((c) => !c.accountId);
      perAccount = myAccounts.map((acc, idx) => {
        let accCamps = my.filter((c) => String(c.accountId) === String(acc.id));
        if (myAccounts.length === 1) {
          const seen = new Set(accCamps.map((c) => c.id));
          for (const c of legacy) if (!seen.has(c.id)) accCamps.push(c);
        } else if (legacy.length && idx === 0) {
          const seen = new Set(accCamps.map((c) => c.id));
          for (const c of legacy) if (!seen.has(c.id)) accCamps.push(c);
        }
        const totalSentAcc = accCamps.reduce((a, c) => a + (c.successful || 0), 0);
        const totalFailedAcc = accCamps.reduce((a, c) => a + (c.failed || 0), 0);
        const totalCampaignsAcc = accCamps.length;
        const totalDestsAcc = accCamps.reduce((a, c) => a + (c.destinations?.length || 0), 0);
        const uniqueGroupsAcc = new Set(accCamps.flatMap((c) => c.destinations || [])).size;
        const runningAcc = accCamps.filter((c) => c.status === "Running" || c.status === "Repeating").length;
        return {
          accountId: acc.id,
          phone: acc.phone,
          username: acc.username,
          displayName: acc.displayName,
          totalCampaigns: totalCampaignsAcc,
          totalSent: totalSentAcc,
          totalFailed: totalFailedAcc,
          totalDestinations: totalDestsAcc,
          uniqueGroups: uniqueGroupsAcc,
          running: runningAcc,
        };
      });
      // per-email totals — never zeroed by Telegram logout
      const myTodayList = my.filter(c => isToday(c.createdAt));
      let myTodaySent = 0;
      let myTodayGroupsSet = new Set<string>();
      for (const c of my) {
        const logs: any[] = (c as any).logs || [];
        const succ = c.successful || 0;
        if (logs.length && logs.length >= succ && succ > 0) {
          for (const l of logs) if (l.status === "Sent" && l.time && isToday(l.time)) { myTodaySent++; if (l.dest) myTodayGroupsSet.add(String(l.dest)); }
        } else if (isToday(c.createdAt)) {
          myTodaySent += succ;
          for (const d of c.destinations || []) myTodayGroupsSet.add(String(d));
        } else if (logs.length) {
          for (const l of logs) if (l.status === "Sent" && l.time && isToday(l.time)) { myTodaySent++; if (l.dest) myTodayGroupsSet.add(String(l.dest)); }
        }
      }
      const myUniqueGroups = new Set(my.flatMap(c => c.destinations || [])).size;
      mine = {
        totalCampaigns: my.length,
        totalSent: my.reduce((a, c) => a + (c.successful || 0), 0),
        totalFailed: my.reduce((a, c) => a + (c.failed || 0), 0),
        totalDestinations: my.reduce((a, c) => a + (c.destinations?.length || 0), 0),
        uniqueGroups: myUniqueGroups,
        running: my.filter((c) => c.status === "Running" || c.status === "Repeating").length,
        todaySent: myTodaySent,
        todayCampaigns: myTodayList.length,
        todayGroups: myTodayGroupsSet.size || new Set(myTodayList.flatMap(c => c.destinations || [])).size,
        campaigns: my.slice(0, 3).map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          successful: c.successful,
          failed: c.failed,
          destinations: c.destinations?.length || 0,
        })),
      };
    }
  } catch {}

  const uniqueGroups = new Set(all.flatMap((c) => c.destinations || [])).size;
  const recentGlobal = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3).map((c) => ({
    id: c.id, name: c.name, status: c.status, successful: c.successful, failed: c.failed, destinations: c.destinations?.length || 0,
  }));
  return NextResponse.json({
    totalCampaigns,
    totalSent,
    totalFailed,
    totalDestinations,
    uniqueGroups,
    running,
    todaySent,
    todayCampaigns,
    todayDestinations,
    todayGroups,
    mine,
    perAccount,
    recent: recentGlobal,
  });
}
