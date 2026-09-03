import fs from "fs"; import path from "path";
import { getCampaigns, getRentals } from "./db";
import { PLANS, PlanId } from "./plans";

const DB_DIR = process.env.VERCEL ? path.join("/tmp", ".data") : path.join(process.cwd(), ".data");
const SUBS_FILE = path.join(DB_DIR, "subscriptions.json");
const KEYS_FILE = path.join(DB_DIR, "license_keys.json");

export type Subscription = {
  id: string;
  userId: string;
  planId: PlanId;
  billing: "daily" | "monthly";
  keyId: string;
  keyCode: string;
  activatedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked";
};

export type LicenseKey = {
  id: string;
  code: string;
  planId: PlanId;
  billing: "daily" | "monthly";
  status: "unused" | "used" | "revoked";
  createdAt: string;
  createdBy?: string;
  usedBy?: string | null;
  usedAt?: string | null;
  expiresAt?: string | null; // key expiry if unused
  note?: string;
};

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  for (const f of [SUBS_FILE, KEYS_FILE]) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");
}
function read<T>(file: string): T[] { ensure(); return JSON.parse(fs.readFileSync(file, "utf-8")); }
function write(file: string, data: any) { ensure(); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

export function getSubscriptions(): Subscription[] { return read<Subscription>(SUBS_FILE); }
export function saveSubscriptions(s: Subscription[]) { write(SUBS_FILE, s); }
export function getLicenseKeys(): LicenseKey[] { return read<LicenseKey>(KEYS_FILE); }
export function saveLicenseKeys(k: LicenseKey[]) { write(KEYS_FILE, k); }

export function getActiveSubscription(userId: string): Subscription | null {
  const now = Date.now();
  const subs = getSubscriptions().filter(s => s.userId === userId && s.status === "active");
  // expire check
  let changed = false;
  for (const s of subs) {
    if (new Date(s.expiresAt).getTime() <= now) { s.status = "expired"; changed = true; }
  }
  if (changed) saveSubscriptions(getSubscriptions().map(x => {
    const m = subs.find(s => s.id === x.id);
    return m ? m : x;
  }));
  const active = getSubscriptions().filter(s => s.userId === userId && s.status === "active" && new Date(s.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())[0] || null;
  return active;
}

export function campaignsTodayCount(userId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return getCampaigns().filter(c => c.userId === userId && c.createdAt.slice(0, 10) === today).length;
}

export function freeRentUsedToday(userId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  // count rentals created today that were free (price 0 or marked free)
  // we store free rentals with price 0
  return getRentals().filter(r => r.userId === userId && r.rentedAt.slice(0, 10) === today && (r as any).isFree).length;
}

export function generateKeyCode(planId: PlanId, billing: "daily" | "monthly"): string {
  const prefix = planId === "max_plus" ? "MAXP" : planId.toUpperCase().slice(0, 4);
  const b = billing === "daily" ? "D" : "M";
  const rand = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).padEnd(4, "X");
  return `${prefix}-${b}-${rand()}-${rand()}-${rand()}`;
}

export function planFromKey(k: LicenseKey) {
  return (PLANS as any)[k.planId] || null;
}
