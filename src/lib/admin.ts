import { NextRequest } from "next/server";
import { verifyToken } from "./auth";

const OWNER_ADMIN = "princeranarealme@gmail.com";

// Owner is always admin, even if ADMIN_EMAILS is set to something else.
export function getAdminEmails(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!fromEnv.includes(OWNER_ADMIN)) fromEnv.push(OWNER_ADMIN);
  return fromEnv;
}

const ADMIN_EMAILS = getAdminEmails();

export function getRequestEmail(req: NextRequest): string {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return String((p as any)?.email || "").toLowerCase();
}

export function isAdminRequest(req: NextRequest): boolean {
  const email = getRequestEmail(req);
  if (!email) return false;
  if (ADMIN_EMAILS.includes(email)) return true;
  // team members with any perm count as admin for the panel (scoped by perm)
  try {
    const { getTeamMemberByEmail } = require("./team");
    if (getTeamMemberByEmail(email)) return true;
  } catch {}
  return false;
}

export function getAdminId(req: NextRequest): string | null {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

export function isOwnerAdmin(req: NextRequest): boolean {
  const email = getRequestEmail(req);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

export function hasPerm(req: NextRequest, perm: string): boolean {
  if (isOwnerAdmin(req)) return true;
  const email = getRequestEmail(req);
  if (!email) return false;
  try {
    const { getTeamMemberByEmail } = require("./team");
    const m = getTeamMemberByEmail(email);
    if (!m) return false;
    return (m.permissions as string[]).includes(perm);
  } catch { return false; }
}

export function requirePerm(req: NextRequest, perm: string): { ok: true } | { ok: false; res: Response } {
  if (!isAdminRequest(req)) return { ok: false, res: Response.json({ error: "Admin only" }, { status: 403 }) as any };
  if (!hasPerm(req, perm)) return { ok: false, res: Response.json({ error: `No permission: ${perm}` }, { status: 403 }) as any };
  return { ok: true };
}
