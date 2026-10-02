import crypto from 'node:crypto';
import { RcsProviderError, type RcsProviderAdapter, type RcsProviderCredentials, type RcsContent, type RcsNormalizedWebhook } from './types.js';

function secretKey(): Buffer {
  const key = process.env.RCS_SECRET_KEY;
  if (!key || key.length < 32) throw new Error('RCS_SECRET_KEY must be configured with at least 32 characters');
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptRcsSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptRcsSecret(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 3) throw new Error('invalid encrypted RCS secret');
  const [iv, tag, ciphertext] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

function assertPublicHttpsEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new RcsProviderError('invalid provider endpoint', 'permanent', 'INVALID_ENDPOINT'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host.endsWith('.localhost')
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    throw new RcsProviderError('provider endpoint must be a public HTTPS hostname', 'permanent', 'INVALID_ENDPOINT');
  }
  return url;
}

export class GenericHttpRcsAdapter implements RcsProviderAdapter {
  readonly key = 'generic-http';

  validateCredentials(credentials: RcsProviderCredentials): void {
    if (!credentials.api_key || credentials.api_key.length > 4096) {
      throw new RcsProviderError('provider API key is required', 'permanent', 'INVALID_CREDENTIALS');
    }
  }

  async send(input: {
    endpoint: string; credentials: RcsProviderCredentials; from: string; to: string;
    content: RcsContent; timeoutMs: number; idempotencyKey?: string;
  }): Promise<{ providerMessageId: string }> {
    this.validateCredentials(input.credentials);
    const url = assertPublicHttpsEndpoint(input.endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(input.timeoutMs, 500), 60000));
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${input.credentials.api_key}`,
          'content-type': 'application/json',
          accept: 'application/json',
          ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
        },
        body: JSON.stringify({ from: input.from, to: input.to, content: input.content }),
      });
      const body = await response.text();
      if (body.length > 64 * 1024) throw new RcsProviderError('provider response too large', 'retryable', 'RESPONSE_TOO_LARGE');
      if (!response.ok) {
        const kind = response.status === 429 || response.status >= 500 ? 'retryable'
          : response.status === 401 || response.status === 403 ? 'auth' : 'permanent';
        throw new RcsProviderError(`provider returned HTTP ${response.status}`, kind, `HTTP_${response.status}`);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { throw new RcsProviderError('provider returned invalid JSON', 'retryable', 'INVALID_RESPONSE'); }
      const providerMessageId = (parsed as { message_id?: unknown; id?: unknown })?.message_id
        ?? (parsed as { id?: unknown })?.id;
      if (typeof providerMessageId !== 'string' || providerMessageId.length > 256) {
        throw new RcsProviderError('provider response missing message id', 'retryable', 'MISSING_PROVIDER_ID');
      }
      return { providerMessageId };
    } catch (error) {
      if (error instanceof RcsProviderError) throw error;
      if ((error as Error).name === 'AbortError') throw new RcsProviderError('provider request timed out', 'retryable', 'TIMEOUT');
      throw new RcsProviderError('provider request failed', 'retryable', 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }

  parseWebhook(input: {
    body: unknown; headers: Record<string, string | string[] | undefined>; secret?: string;
  }): RcsNormalizedWebhook | null {
    if (!input.secret || typeof input.body !== 'object' || input.body === null) return null;
    const signatureHeader = input.headers['x-rcs-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
    const raw = Buffer.from(JSON.stringify(input.body));
    const expected = crypto.createHmac('sha256', input.secret).update(raw).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    const body = input.body as Record<string, unknown>;
    const providerMessageId = body.message_id ?? body.id;
    const status = normalizeProviderStatus(body.status);
    if (typeof providerMessageId !== 'string' || providerMessageId.length > 256 || !status) return null;
    return {
      event_id: typeof body.event_id === 'string' ? body.event_id.slice(0, 256) : undefined,
      provider_message_id: providerMessageId,
      status,
      error_code: typeof body.error_code === 'string' ? body.error_code.slice(0, 100) : undefined,
      error_description: typeof body.error === 'string' ? body.error.slice(0, 500) : undefined,
      delivered_at: typeof body.timestamp === 'string' ? body.timestamp : undefined,
    };
  }
}

function normalizeProviderStatus(value: unknown): RcsNormalizedWebhook['status'] | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase()) {
    case 'accepted': case 'queued': case 'submitted': return value.toLowerCase() as RcsNormalizedWebhook['status'];
    case 'delivered': case 'read': return 'delivered';
    case 'undelivered': case 'not_delivered': return 'undelivered';
    case 'expired': case 'timeout': return 'expired';
    case 'rejected': case 'invalid': return 'rejected';
    case 'failed': case 'failure': return 'failed';
    default: return null;
  }
}
