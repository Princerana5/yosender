import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH!;
const g: any = globalThis as any;
if (!g.__tgm_client) g.__tgm_client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5 });
export const tgClient: TelegramClient = g.__tgm_client;
export const pending: Map<string, { phoneCodeHash: string; phone: string }> = g.__tgm_pending ?? (g.__tgm_pending = new Map());
export function getClient(sessionString: string) {
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
}
