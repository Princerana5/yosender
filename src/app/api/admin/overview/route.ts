import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { getUsers, getAccounts, getCampaigns, getRentalPool, getRentals } from "@/lib/db";
import { getSubscriptions, getLicenseKeys } from "@/lib/subscriptions";
import { getGroups, getGroupStats } from "@/lib/groups-db";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "overview")) return NextResponse.json({ error: "No permission: overview" }, { status: 403 });
  const users = getUsers();
  const accounts = getAccounts();
  const campaigns = getCampaigns();
  const pool = getRentalPool();
  const rentals = getRentals();
  const subs = getSubscriptions();
  const keys = getLicenseKeys();
  const now = Date.now();
  const activeSubs = subs.filter(s => s.status === "active" && new Date(s.expiresAt).getTime() > now);
  const totalSent = campaigns.reduce((a, c) => a + (c.successful || 0), 0);
  const running = campaigns.filter(c => c.status === "Running" || c.status === "Repeating").length;
  const bannedUsers = users.filter((u: any) => u.isBanned).length;
  let groupStats: any = null;
  try { groupStats = getGroupStats(); } catch {}
  return NextResponse.json({
    counts: {
      users: users.length,
      bannedUsers,
      tgAccounts: accounts.length,
      campaigns: campaigns.length,
      running,
      totalSent,
      pool: pool.length,
      poolAvailable: pool.filter(p => p.status === "available").length,
      poolRented: pool.filter(p => p.status === "rented").length,
      rentals: rentals.length,
      activeRentals: rentals.filter(r => r.status === "active").length,
      subscriptions: subs.length,
      activeSubscriptions: activeSubs.length,
      keys: keys.length,
      unusedKeys: keys.filter(k => k.status === "unused").length,
      groups: groupStats?.total ?? 0,
    },
    groupStats,
    planBreakdown: (() => {
      const m: Record<string, number> = {};
      for (const s of activeSubs) m[s.planId] = (m[s.planId] || 0) + 1;
      return m;
    })(),
  });
}
