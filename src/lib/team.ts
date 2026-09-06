import fs from "fs";
import path from "path";

const DB_DIR = process.env.VERCEL ? path.join("/tmp", ".data") : path.join(process.cwd(), ".data");
const TEAM_FILE = path.join(DB_DIR, "team.json");

export const ALL_PERMS = ["overview", "users", "rentals", "keys", "subs", "campaigns", "team", "groups"] as const;
export type Perm = typeof ALL_PERMS[number];

export const PERM_LABELS: Record<Perm, { label: string; desc: string }> = {
  overview: { label: "Overview", desc: "View dashboard stats & counts" },
  users: { label: "Users", desc: "View, ban, reset password, delete users" },
  rentals: { label: "Rented Accounts", desc: "Add pool accounts, ban, force-free, delete" },
  keys: { label: "License Keys", desc: "Generate & revoke license keys" },
  subs: { label: "Subscriptions", desc: "View, revoke & extend subscriptions" },
  campaigns: { label: "Campaigns", desc: "View all campaigns" },
  team: { label: "Team", desc: "Invite & manage team members" },
  groups: { label: "Groups", desc: "Manage collected group links, categories, import/export" },
};

export type TeamMember = {
  id: string;
  email: string;
  name?: string;
  role: string;
  permissions: Perm[];
  status: "active" | "revoked";
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(TEAM_FILE)) fs.writeFileSync(TEAM_FILE, "[]");
}
function read(): TeamMember[] {
  ensure();
  try { return JSON.parse(fs.readFileSync(TEAM_FILE, "utf-8")); } catch { return []; }
}
function write(data: TeamMember[]) {
  ensure();
  fs.writeFileSync(TEAM_FILE, JSON.stringify(data, null, 2));
}

export function getTeam(): TeamMember[] { return read(); }
export function saveTeam(t: TeamMember[]) { write(t); }

export function getTeamMemberByEmail(email: string): TeamMember | null {
  const e = email.trim().toLowerCase();
  return read().find(m => m.email.toLowerCase() === e && m.status === "active") || null;
}

export function hasTeamPerm(email: string, perm: Perm): boolean {
  const m = getTeamMemberByEmail(email);
  if (!m) return false;
  return m.permissions.includes(perm);
}

export function isValidPerm(p: string): p is Perm {
  return (ALL_PERMS as readonly string[]).includes(p);
}

export function normalizePerms(perms: string[]): Perm[] {
  const out: Perm[] = [];
  for (const p of perms) {
    const v = String(p).trim().toLowerCase();
    if (isValidPerm(v) && !out.includes(v)) out.push(v);
  }
  return out;
}
