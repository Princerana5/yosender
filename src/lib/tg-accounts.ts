import { getAccounts, saveAccounts, TgAccount } from "./db";
import { verifyToken } from "./auth";
import { NextRequest } from "next/server";

export const MAX_TG_ACCOUNTS = 10;

export function getUserIdFromReq(req: NextRequest): string | null {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? verifyToken(t) : null;
  return (p as any)?.id || null;
}

export function getActiveId(req: NextRequest): string | null {
  return req.cookies.get("tg_active_id")?.value || null;
}

export function getUserAccounts(userId: string): TgAccount[] {
  return getAccounts().filter((a) => a.userId === userId);
}

export function getActiveAccount(req: NextRequest): TgAccount | null {
  const uid = getUserIdFromReq(req);
  if (!uid) return null;
  const list = getUserAccounts(uid);
  if (!list.length) return null;
  const activeId = getActiveId(req);
  if (activeId) {
    const found = list.find((a) => a.id === activeId);
    if (found) return found;
  }
  return list[0];
}

export function getSessionForReq(req: NextRequest): string | null {
  const active = getActiveAccount(req);
  if (active?.session) return active.session;
  return req.cookies.get("tg_session")?.value || null;
}

export function getSessionForAccount(userId: string, accountId: string | null): string | null {
  if (!accountId) return null;
  const acc = getAccounts().find((a) => a.id === String(accountId) && a.userId === userId);
  return acc?.session || null;
}

export function getAccountForReqWithAccount(req: NextRequest, accountId?: string | null) {
  const uid = getUserIdFromReq(req);
  if (uid && accountId) {
    const acc = getAccounts().find((a) => a.id === String(accountId) && a.userId === uid);
    // Explicit account requested but not found (belongs to another user or was
    // deleted): return null so callers 401/404 instead of silently serving the
    // ACTIVE account's data — that fallback is what showed account B's groups
    // while acting on account A ("wrong groups", leaves that do nothing).
    if (acc?.session) return acc;
    return null;
  }
  return getActiveAccount(req);
}

export function getSessionForReqWithAccount(req: NextRequest, accountId?: string | null): string | null {
  // Explicit account requested but not found: return null (401/400 upstream),
  // NEVER fall back to the active session — that fallback acted on the wrong
  // account (wrong groups, leaves/sends that "succeed" but do nothing).
  if (accountId) {
    const acc = getAccountForReqWithAccount(req, accountId);
    return acc?.session || null;
  }
  const acc = getAccountForReqWithAccount(req, accountId);
  if (acc?.session) return acc.session;
  return getSessionForReq(req);
}
