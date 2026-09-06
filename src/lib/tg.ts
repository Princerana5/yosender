import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

function readApiId(): number {
  return Number(process.env.TELEGRAM_API_ID);
}
function readApiHash(): string {
  return process.env.TELEGRAM_API_HASH || "";
}

const g: any = globalThis as any;
if (!g.__tgm_client) {
  g.__tgm_client = new TelegramClient(
    new StringSession(""),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH || "dummy-for-init",
    { connectionRetries: 5 },
  );
}
export const tgClient: TelegramClient = g.__tgm_client;
export type PendingEntry = { phoneCodeHash: string; phone: string; dcId?: number };
export const pending: Map<string, PendingEntry> = g.__tgm_pending ?? (g.__tgm_pending = new Map());
export function getClient(sessionString: string) {
  return new TelegramClient(new StringSession(sessionString), readApiId(), readApiHash(), { connectionRetries: 5 });
}
// Fresh unauthorized client for login (SendCode / SignIn) flows.
// MUST be used instead of the shared tgClient: once tgClient has completed any
// login its session is authorized, and gramjs then refuses to follow
// PHONE_MIGRATE_* ("associated with DC N") for a different number —
// it rethrows instead of switching DC. A blank-session client is never
// authorized, so invoke() auto-switches DC and retries transparently.
export function createLoginClient() {
  const apiId = readApiId();
  const apiHash = readApiHash();
  if (!apiId || !apiHash) {
    throw new Error("Server misconfigured: TELEGRAM_API_ID / TELEGRAM_API_HASH missing. Check .env.local and restart.");
  }
  return new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
}
// dcId the client ended up on after SendCode (follows migrations).
export function loginClientDcId(client: TelegramClient): number | undefined {
  try {
    const id = (client.session as any)?.dcId;
    return typeof id === "number" ? id : undefined;
  } catch { return undefined; }
}
