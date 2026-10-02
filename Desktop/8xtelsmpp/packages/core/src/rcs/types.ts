import { z } from 'zod';

export const rcsStatus = z.enum([
  'accepted', 'queued', 'submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed',
]);
export type RcsStatus = z.infer<typeof rcsStatus>;

const httpsUrl = z.string().url().max(2048).refine((value) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}, 'URL must use HTTPS');

const suggestedAction = z.object({
  type: z.enum(['reply', 'open_url', 'dial', 'view_location']),
  text: z.string().min(1).max(80),
  url: httpsUrl.optional(),
  phone_number: z.string().max(32).optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'open_url' && !value.url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'URL is required' });
  if (value.type === 'dial' && !value.phone_number) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone_number'], message: 'phone_number is required' });
});

export const rcsContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(4096) }),
  z.object({
    type: z.literal('rich_card'),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    media_url: httpsUrl.optional(),
    suggestions: z.array(suggestedAction).max(10).default([]),
  }),
  z.object({
    type: z.literal('carousel'),
    cards: z.array(z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      media_url: httpsUrl.optional(),
      suggestions: z.array(suggestedAction).max(10).default([]),
    })).min(1).max(10),
  }),
]);
export type RcsContent = z.infer<typeof rcsContent>;

export const rcsMessageRequest = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(7).max(20),
  content: rcsContent,
  client_message_id: z.string().max(128).optional(),
  idempotency_key: z.string().min(8).max(128).optional(),
});
export type RcsMessageRequest = z.infer<typeof rcsMessageRequest>;

export interface RcsMessageJob {
  message_id: string;
  client_id: string;
  campaign_id?: string;
}

export interface RcsRouteCandidate {
  route_id: string;
  vendor_id: string;
  priority: number;
  weight: number;
  tps_limit: number | null;
}

export type RcsNormalizedWebhook = {
  event_id?: string;
  provider_message_id: string;
  status: RcsStatus;
  error_code?: string;
  error_description?: string;
  delivered_at?: string;
};

export type RcsProviderCredentials = Record<string, string>;

export interface RcsProviderAdapter {
  readonly key: string;
  validateCredentials(credentials: RcsProviderCredentials): void;
  send(input: {
    endpoint: string;
    credentials: RcsProviderCredentials;
    from: string;
    to: string;
    content: RcsContent;
    timeoutMs: number;
    idempotencyKey?: string;
  }): Promise<{ providerMessageId: string }>;
  parseWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    secret?: string;
  }): RcsNormalizedWebhook | null;
}

export class RcsProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'retryable' | 'rate_limited' | 'permanent' | 'auth',
    readonly code?: string,
  ) { super(message); this.name = 'RcsProviderError'; }
}

export function normalizeRcsDestination(input: string): string | null {
  const value = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+?[1-9]\d{6,14}$/.test(value)) return null;
  return value.startsWith('+') ? value : `+${value}`;
}

export function statusIsTerminal(status: RcsStatus): boolean {
  return ['delivered', 'undelivered', 'expired', 'rejected', 'failed'].includes(status);
}

export function shouldAdvanceStatus(current: RcsStatus, next: RcsStatus): boolean {
  if (current === next) return false;
  if (statusIsTerminal(current)) return false;
  return true;
}
