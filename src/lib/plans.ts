export type PlanId = "elite" | "pro" | "max_plus" | "luxe";

export type Billing = "daily" | "monthly";

export type Plan = {
  id: PlanId;
  name: string;
  badge: string;
  dailyPrice: number;
  monthlyPrice: number | null;
  groupsPerCampaign: number;
  campaignsPerDay: number; // Infinity = no limit
  minRepeatMins: number;
  freeRentPerDay: number;
  features: string[];
  popular?: boolean;
  vip?: boolean;
  color: string;
};

export const PLANS: Record<PlanId, Plan> = {
  elite: {
    id: "elite",
    name: "Elite",
    badge: "ELITE",
    dailyPrice: 2,
    monthlyPrice: 55,
    groupsPerCampaign: 10,
    campaignsPerDay: 10,
    minRepeatMins: 15,
    freeRentPerDay: 0,
    color: "from-slate-700 to-slate-900",
    features: [
      "10 groups per campaign",
      "10 campaigns per day",
      "Repeat min 15 minutes",
      "No free rented accounts",
      "Standard support",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    badge: "PRO",
    dailyPrice: 5,
    monthlyPrice: 150,
    groupsPerCampaign: 100,
    campaignsPerDay: 30,
    minRepeatMins: 1,
    freeRentPerDay: 1,
    color: "from-[#229ED9] to-[#0E7490]",
    features: [
      "100 groups per campaign",
      "30 campaigns per day",
      "Repeat from 1 minute",
      "1 rented account / day free",
      "Priority support",
    ],
  },
  max_plus: {
    id: "max_plus",
    name: "Max+",
    badge: "MAX+",
    dailyPrice: 12,
    monthlyPrice: 299,
    groupsPerCampaign: 1000,
    campaignsPerDay: Infinity,
    minRepeatMins: 1,
    freeRentPerDay: 3,
    popular: true,
    color: "from-violet-600 to-indigo-700",
    features: [
      "1,000 groups per campaign",
      "Unlimited campaigns",
      "No repeat limit",
      "3 rented accounts / day free",
      "Priority support",
    ],
  },
  luxe: {
    id: "luxe",
    name: "Luxe",
    badge: "LUXE",
    dailyPrice: 0,
    monthlyPrice: 1300,
    groupsPerCampaign: 10000,
    campaignsPerDay: Infinity,
    minRepeatMins: 1,
    freeRentPerDay: 10,
    vip: true,
    color: "from-amber-500 via-orange-500 to-pink-600",
    features: [
      "10,000+ groups per campaign",
      "Unlimited campaigns & repeats",
      "10 rented accounts / day free",
      "Whole tool unlimited",
      "VIP 24/7 dedicated support",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["elite", "pro", "max_plus", "luxe"];

export function getPlan(id: string | null | undefined): Plan | null {
  if (!id) return null;
  return (PLANS as any)[id] || null;
}

export function formatPrice(p: Plan, billing: Billing) {
  if (p.id === "luxe") return `$${p.monthlyPrice}/mo`;
  if (billing === "daily") return `$${p.dailyPrice}/day`;
  return `$${p.monthlyPrice}/mo`;
}

export function planAllows(plan: Plan | null, groups: number, repeatMins?: number | null) {
  if (!plan) return { ok: false, reason: "No active subscription — redeem a key to activate a plan." };
  if (groups > plan.groupsPerCampaign) return { ok: false, reason: `${plan.name} allows max ${plan.groupsPerCampaign} groups per campaign (you selected ${groups}). Upgrade to increase limit.` };
  if (repeatMins != null && repeatMins < plan.minRepeatMins) return { ok: false, reason: `${plan.name} requires repeat interval ≥ ${plan.minRepeatMins} min (you set ${repeatMins} min).` };
  return { ok: true, reason: "" };
}
