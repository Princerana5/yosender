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

export function getSessionForReqWithAccount(req: NextRequest, accountId?: string | null): string | null {
  const uid = getUserIdFromReq(req);
  if (uid && accountId) {
    const s = getSessionForAccount(uid, accountId);
    if (s) return s;
  }
  return getSessionForReq(req);
}
