import { TelegramClient } from "telegram";
import { Api } from "telegram/tl";
import { computeCheck } from "telegram/Password";
import { createLoginClient, loginClientDcId, pending } from "./tg";

// Read inside the function (not at module top): Next inlines module-level
// env at build time, which bakes a stale/empty value into the VPS bundle.

// GramJS surfaces a PHONE_MIGRATE_N failure as one of these shapes:
//  - PhoneMigrateError instance: e.newDc = N
//  - RPCError.message: "The phone number ... is associated with DC N (caused by auth.SendCode)"
export function migrateDcFromError(e: any): number | undefined {
  try {
    if (typeof e?.newDc === "number" && Number.isFinite(e.newDc)) return e.newDc;
    const m = String(e?.errorMessage || e?.message || "");
    let hit = m.match(/PHONE_MIGRATE_(\d+)/);
    if (hit) return Number(hit[1]);
    hit = m.match(/associated with DC (\d+)/i);
    if (hit && /phone number/i.test(m)) return Number(hit[1]);
  } catch {}
  return undefined;
}

function friendlySendCodeError(raw: string): string {
  const m = String(raw || "");
  if (m.includes("PHONE_NUMBER_INVALID")) return "That phone number looks invalid — include the country code, e.g. +91 98765 43210";
  if (m.includes("PHONE_NUMBER_FLOOD")) return "Too many code requests from this number — wait a few minutes and try again";
  if (m.includes("PHONE_NUMBER_BANNED")) return "Telegram has banned logins for this number";
  if (m.includes("FLOOD_WAIT_")) {
    const s = m.match(/FLOOD_WAIT_(\d+)/)?.[1];
    return `Telegram is rate-limiting us — wait ${s ? `${s} seconds` : "a bit"} and try again`;
  }
  if (m.includes("API_ID_INVALID") || m.includes("API_HASH")) return "Server misconfigured: TELEGRAM_API_ID / TELEGRAM_API_HASH rejected by Telegram";
  return m;
}

// ── Per-phone login connections ──────────────────────────────────────────
// The code hash Telegram issues is only honored on the datacenter (and
// connection) that issued it. Previously SendCode and SignIn each used a
// throwaway client, so any DC mismatch between the two calls surfaced as
// PHONE_CODE_EXPIRED even with a correct code. Now the client that sent the
// code stays connected and the verify step reuses it — same DC, same auth
// key, no pinning guesswork. Slots auto-close after 5 idle minutes.
type LoginSlot = { client: TelegramClient; cleanup?: ReturnType<typeof setTimeout> };
const g: any = globalThis as any;
const loginSlots: Map<string, LoginSlot> = g.__tgm_login_slots ?? (g.__tgm_login_slots = new Map());

function maskPhone(p: string): string {
  return p.length <= 6 ? "***" : `${p.slice(0, 4)}***${p.slice(-2)}`;
}
function hashHead(h: string): string {
  return h ? h.slice(0, 8) : "(none)";
}

function touchSlotCleanup(key: string, ms = 5 * 60 * 1000) {
  const slot = loginSlots.get(key);
  if (!slot) return;
  if (slot.cleanup) clearTimeout(slot.cleanup);
  slot.cleanup = setTimeout(() => {
    const s = loginSlots.get(key);
    if (s) {
      loginSlots.delete(key);
      s.client.disconnect().catch(() => {});
    }
  }, ms);
  (slot.cleanup as any)?.unref?.();
}

async function getLoginClient(key: string): Promise<TelegramClient> {
  const existing = loginSlots.get(key);
  if (existing) {
    try {
      if (!existing.client.connected) await existing.client.connect();
    } catch {}
    touchSlotCleanup(key);
    return existing.client;
  }
  const client = createLoginClient();
  await client.connect();
  loginSlots.set(key, { client });
  touchSlotCleanup(key);
  return client;
}

function dropLoginClient(key: string) {
  const slot = loginSlots.get(key);
  if (!slot) return;
  loginSlots.delete(key);
  if (slot.cleanup) clearTimeout(slot.cleanup);
  slot.client.disconnect().catch(() => {});
}

// Send an OTP code. Reuses the phone's login connection when one exists
// (already on the right DC), otherwise connects fresh and follows an
// explicit PHONE_MIGRATE_N switch before retrying once. The code hash is
// only valid on the issuing DC, so its dcId is stored for SignIn fallback
// and returned to the browser (server memory alone doesn't survive restarts).
export async function sendLoginCode(phone: string): Promise<{ phoneCodeHash: string; dcId?: number }> {
  if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
    throw new Error("Server misconfigured: TELEGRAM_API_ID / TELEGRAM_API_HASH missing. Check .env.local and restart.");
  }
  const p = phone.trim().replace(/\s+/g, "");
  if (!p) throw new Error("phone required");

  const liveApiId = Number(process.env.TELEGRAM_API_ID);
  const liveApiHash = process.env.TELEGRAM_API_HASH || "";
  const client = await getLoginClient(p);
  try {
    let res: any;
    try {
      res = await client.sendCode({ apiId: liveApiId, apiHash: liveApiHash } as any, p);
    } catch (e: any) {
      const dc = migrateDcFromError(e);
      if (!dc) throw new Error(friendlySendCodeError(e?.errorMessage || e?.message || String(e)));
      // client.sendCode usually auto-migrates inside invoke(); if it still
      // threw, switch explicitly and retry once on the owning DC.
      try {
        await (client as any)._switchDC(dc);
      } catch {
        throw new Error("Telegram datacenter switch failed — try again in a few seconds");
      }
      try {
        res = await client.sendCode({ apiId: liveApiId, apiHash: liveApiHash } as any, p);
      } catch (e2: any) {
        throw new Error(friendlySendCodeError(e2?.errorMessage || e2?.message || String(e2)));
      }
    }
    const hash = res?.phoneCodeHash || res?.phone_code_hash;
    if (!hash) throw new Error("Telegram didn't return phoneCodeHash. Try again.");
    const dcId = loginClientDcId(client);
    const entry = { phoneCodeHash: hash, phone: p, dcId };
    pending.set(p, entry);
    pending.set(phone.trim(), entry);
    touchSlotCleanup(p);
    console.log(`[tg-login:send] phone=${maskPhone(p)} dcId=${dcId} hash=${hashHead(hash)}`);
    return { phoneCodeHash: hash, dcId };
  } catch (e) {
    // Keep the slot: the connection itself is still good, only this send failed.
    throw e;
  }
}

// Verify the OTP (and optional 2FA password) on the SAME connection that
// sent the code, so the hash is always presented to the DC that issued it.
// Falls back to a fresh DC-pinned client only when the slot is gone (e.g.
// the server restarted between Send and Verify). Returns the session string
// of the now-authorized account plus basic profile fields.
export async function verifyLoginCode(opts: {
  phone: string;
  code: string;
  password?: string;
  phoneCodeHash?: string;
  dcId?: number;
}): Promise<{ session: string; username: string; firstName: string; lastName: string }> {
  const tp = String(opts.phone || "").trim().replace(/\s+/g, "");
  const tc = String(opts.code || "").trim().replace(/\s+/g, "");
  if (!tp || !tc) throw new Error("phone and code required");

  let hash = opts.phoneCodeHash?.trim() || pending.get(opts.phone.trim())?.phoneCodeHash || pending.get(tp)?.phoneCodeHash;
  let dcId: number | undefined =
    (typeof opts.dcId === "number" && Number.isFinite(opts.dcId) ? opts.dcId : undefined) ??
    pending.get(opts.phone.trim())?.dcId ?? pending.get(tp)?.dcId;
  if (!hash && pending.size === 1) {
    const only = Array.from(pending.values())[0];
    hash = only.phoneCodeHash;
    dcId = only.dcId;
  }
  if (!hash) throw new Error("No code session found. Tap Send Verification Code again and verify within 30 seconds.");

  const slot = loginSlots.get(tp);
  let client: TelegramClient;
  let fallback = false;
  if (slot) {
    client = slot.client;
    try {
      if (!client.connected) await client.connect();
    } catch {}
    console.log(`[tg-login:verify] phone=${maskPhone(tp)} reuse slot dcId=${loginClientDcId(client)} wantDc=${dcId} hash=${hashHead(hash)}`);
  } else {
    console.log(`[tg-login:verify] phone=${maskPhone(tp)} no slot (server restarted?) — fresh client pinned to dcId=${dcId} hash=${hashHead(hash)}`);
    client = createLoginClient();
    await client.connect();
    fallback = true;
    if (dcId && (client.session as any)?.dcId !== dcId) {
      try {
        await (client as any)._switchDC(dcId);
      } catch {
        try { await client.disconnect(); } catch {}
        throw new Error("Reconnect to Telegram failed — tap Send Code again for a fresh code");
      }
    }
  }

  try {
    let needPassword = false;
    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber: tp, phoneCodeHash: hash, phoneCode: tc }));
    } catch (e: any) {
      const m = e.errorMessage || e.message || String(e);
      if (m.includes("SESSION_PASSWORD_NEEDED")) {
        needPassword = true;
      } else if (migrateDcFromError(e)) {
        throw new Error("Session moved datacenters — tap Send Code again and use the NEW code");
      } else if (m.includes("PHONE_CODE_EXPIRED")) {
        throw new Error("That code is no longer valid — tap Send Code again and enter the NEW code from Telegram right away");
      } else if (m.includes("PHONE_CODE_INVALID")) {
        throw new Error("Invalid code — make sure you use the latest code from Telegram (check Telegram app, not SMS)");
      } else if (m.includes("PHONE_NUMBER_INVALID") || m.includes("PHONE_NUMBER_FLOOD")) {
        throw new Error(m);
      } else {
        throw new Error(m);
      }
    }
    if (needPassword) {
      const password = opts.password ? String(opts.password) : "";
      if (!password) {
        const err: any = new Error("2FA password required — enter your Telegram cloud password");
        err.needPassword = true;
        throw err;
      }
      try {
        const pwdInfo: any = await client.invoke(new Api.account.GetPassword());
        await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwdInfo, password) }));
      } catch (pwdErr: any) {
        const pm = pwdErr.errorMessage || pwdErr.message || String(pwdErr);
        if (pm.includes("PASSWORD_HASH_INVALID") || pm.includes("PASSWORD_INVALID")) {
          const err: any = new Error("Wrong 2FA password — try again");
          err.needPassword = true;
          throw err;
        }
        throw new Error(pm);
      }
    }
    const sessionString = (client.session as any).save() as string;
    let me: any;
    try { me = await client.getMe(); } catch { me = { username: tp, firstName: "" }; }
    pending.delete(opts.phone.trim());
    pending.delete(tp);
    dropLoginClient(tp);
    return {
      session: sessionString,
      username: me.username || "",
      firstName: me.firstName || "",
      lastName: me.lastName || "",
    };
  } catch (e) {
    // Keep the slot so the user can resend / retry on the same good connection.
    // Only a throwaway fallback client gets disconnected here.
    if (fallback) {
      try { await client.disconnect(); } catch {}
    }
    throw e;
  }
}

// Create a fully authorized client for an already-saved session string.
// Used by harvest/verify helpers that must not touch the shared login client.
export async function connectSessionClient(sessionString: string): Promise<TelegramClient> {
  const { getClient } = await import("./tg");
  const client = getClient(sessionString);
  await client.connect();
  return client;
}
