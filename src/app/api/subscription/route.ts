import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getActiveSubscription, campaignsTodayCount, freeRentUsedToday } from "@/lib/subscriptions";
import { getPlan } from "@/lib/plans";

function uid(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

export async function GET(req: NextRequest) {
  const id = uid(req);
  if (!id) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const sub = getActiveSubscription(id);
  const plan = sub ? getPlan(sub.planId) : null;
  const todayCount = campaignsTodayCount(id);
  const freeUsed = freeRentUsedToday(id);
  const freePerDay = plan ? plan.freeRentPerDay : 0;
  return NextResponse.json({
    subscription: sub,
    plan,
    usage: {
      campaignsToday: todayCount,
      campaignsLimit: plan ? (plan.campaignsPerDay === Infinity ? null : plan.campaignsPerDay) : null,
      freeRentUsedToday: freeUsed,
      freeRentPerDay: freePerDay,
      freeLeft: Math.max(0, freePerDay - freeUsed),
      freeUsed,
    },
  });
}
