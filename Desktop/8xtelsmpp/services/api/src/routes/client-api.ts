import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  queryOne, getPool, getQueue, QUEUES, tryAcquireTps, incrStat,
  parseDestinations, type MessageJob,
} from '@8xtel/core';

const router = Router();

// ── Client HTTP send API (v1) ────────────────────────────────────────────────
// Auth: per-client API key — `Authorization: Bearer <key>` or `?api_key=`.
// Keys are managed in the panel (Clients → API keys); only sha256 hashes
// are stored, plaintext shown once at creation.
//
//   POST /client/v1/send        { from, to, text, dlr_url? }
//   POST /client/v1/send-bulk   { from, to: "num1,num2…", text, dlr_url? }
//   GET  /client/v1/status/:id  (our internal message id)
//   GET  /client/v1/balance
//
// Guards mirror smpp-server/session.ts + portal /send exactly: active
// account, balance/credit, TPS (429, never drop), blocked sender ids.
// Accepted messages flow through the SAME pipeline (routing → vendor →
// DLR → billing). DLR callbacks reuse the existing sms-client-dlr-http
// queue — set dlr_url per request or store a default on the client row.

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

interface ApiClient {
  id: string; name: string; status: string; balance: string;
  credit_limit: string; tps_limit: number; dlr_callback_url: string | null;
}

async function keyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const key = fromHeader || String((req.query as Record<string, string>).api_key ?? '').trim();
  if (!key || key.length < 16) {
    res.status(401).json({ error: 'missing or invalid api key' });
    return;
  }
  const row = await queryOne<{ client_id: string; key_id: string }>(
    `SELECT k.client_id, k.id AS key_id FROM client_api_keys k
     WHERE k.key_hash=$1 AND k.is_active=true`,
    [hashKey(key)],
  );
  if (!row) {
    res.status(401).json({ error: 'invalid api key' });
    return;
  }
  const client = await queryOne<ApiClient>(
    `SELECT id, name, status, balance, credit_limit, tps_limit, dlr_callback_url
     FROM clients WHERE id=$1`,
    [row.client_id],
  );
  if (!client) {
    res.status(401).json({ error: 'account not found' });
    return;
  }
  (req as Request & { apiClient: ApiClient; apiKeyId: string }).apiClient = client;
  (req as Request & { apiClient: ApiClient; apiKeyId: string }).apiKeyId = row.key_id;
  // Best-effort usage stamp (never blocks the send)
  void getPool().query(
    'UPDATE client_api_keys SET last_used_at=now() WHERE id=$1', [row.key_id],
  ).catch(() => undefined);
  next();
}

const ac = (req: Request): ApiClient => (req as Request & { apiClient: ApiClient }).apiClient;

router.use(keyAuth);

async function guardClient(client: ApiClient): Promise<{ ok: true } | { ok: false; code: number; error: string }> {
  if (client.status !== 'active') return { ok: false, code: 422, error: `account is ${client.status}` };
  if (Number(client.balance) + Number(client.credit_limit) <= 0) {
    return { ok: false, code: 422, error: 'insufficient balance — please top up' };
  }
  if (!(await tryAcquireTps(`client:${client.id}`, client.tps_limit))) {
    return { ok: false, code: 429, error: 'sending too fast — try again in a second' };
  }
  return { ok: true };
}

async function senderAllowed(clientId: string, source: string): Promise<string | null> {
  const rule = await queryOne<{ status: string }>(
    `SELECT status FROM sender_ids WHERE client_id=$1 AND sender=$2
     ORDER BY country_id NULLS LAST LIMIT 1`,
    [clientId, source],
  );
  return rule && rule.status === 'blocked' ? `sender id "${source}" is not allowed on your account` : null;
}

async function enqueue(
  client: ApiClient, source: string, destination: string, text: string, dlrUrl: string | null,
): Promise<{ id: string; client_msg_id: string }> {
  const internalId = randomUUID();
  const clientMsgId = `h-${internalId.slice(0, 8)}`;
  await getPool().query(
    `INSERT INTO messages (id, client_id, channel, client_msg_id, source, destination, text, data_coding, status)
     VALUES ($1,$2,'sms',$3,$4,$5,$6,0,'submitted')`,
    [internalId, client.id, clientMsgId, source, destination, text],
  );
  const job: MessageJob = {
    internal_id: internalId, client_id: client.id, client_msg_id: clientMsgId,
    channel: 'sms', source, destination, country_id: null,
    text, data_coding: 0, route_id: null, attempts: 0,
  };
  await getQueue(QUEUES.submit).add('submit', job, { jobId: internalId });
  await incrStat('submitted');
  // Per-request DLR callback override: the dlr-worker fan-out only reads the
  // stored client URL, so a differing override becomes the new stored default
  // (operator-visible in the panel). Also flips dlr_mode to http when the
  // client never set one — otherwise the worker would skip the callback.
  if (dlrUrl && dlrUrl !== client.dlr_callback_url) {
    await getPool().query(
      `UPDATE clients SET dlr_callback_url=$1,
        dlr_mode=CASE WHEN dlr_mode IN ('http','api') THEN dlr_mode ELSE 'http' END
       WHERE id=$2`,
      [dlrUrl, client.id],
    );
  }
  return { id: internalId, client_msg_id: clientMsgId };
}

const sendSchema = z.object({
  from: z.string().min(1).max(21),
  to: z.string().min(4).max(20),
  text: z.string().min(1).max(2000),
  dlr_url: z.string().url().max(500).nullable().optional(),
});

router.post('/send', async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const client = ac(req);
  const g = await guardClient(client);
  if (!g.ok) {
    res.status(g.code).json({ error: g.error });
    return;
  }
  const blocked = await senderAllowed(client.id, parsed.data.from);
  if (blocked) {
    res.status(422).json({ error: blocked });
    return;
  }
  const { id, client_msg_id } = await enqueue(
    client, parsed.data.from, parsed.data.to, parsed.data.text, parsed.data.dlr_url ?? null,
  );
  res.status(202).json({ id, client_msg_id, to: parsed.data.to, status: 'submitted' });
});

const bulkSchema = z.object({
  from: z.string().min(1).max(21),
  to: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(5000)]),
  text: z.string().min(1).max(2000),
  dlr_url: z.string().url().max(500).nullable().optional(),
});

router.post('/send-bulk', async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const client = ac(req);
  const g = await guardClient(client);
  if (!g.ok) {
    res.status(g.code).json({ error: g.error });
    return;
  }
  const blocked = await senderAllowed(client.id, parsed.data.from);
  if (blocked) {
    res.status(422).json({ error: blocked });
    return;
  }
  const raw = Array.isArray(parsed.data.to) ? parsed.data.to.join(',') : parsed.data.to;
  const { numbers, invalid } = parseDestinations(raw, 5000);
  if (!numbers.length) {
    res.status(400).json({ error: 'no valid destinations', invalid: invalid.slice(0, 20) });
    return;
  }
  const ids: Array<{ to: string; id: string }> = [];
  for (const dest of numbers) {
    const { id } = await enqueue(client, parsed.data.from, dest, parsed.data.text, parsed.data.dlr_url ?? null);
    ids.push({ to: dest, id });
  }
  res.status(202).json({ accepted: ids.length, invalid: invalid.slice(0, 20), messages: ids });
});

router.get('/status/:id', async (req, res) => {
  const client = ac(req);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const msg = await queryOne<{
    id: string; source: string; destination: string; status: string;
    error_code: string | null; submit_time: string; dlr_time: string | null;
  }>(
    `SELECT id, source, destination, status, error_code, submit_time, dlr_time
     FROM messages WHERE id=$1 AND client_id=$2`,
    [req.params.id, client.id],
  );
  if (!msg) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ message: msg });
});

// ── Self-serve docs (§33): clients fetch integration docs with their own
// API key — no panel login needed. Returns endpoints + curl samples so a
// client can integrate from one call. Format: ?format=json (default) | markdown.
router.get('/docs', async (req, res) => {
  const format = String((req.query as Record<string, string>).format ?? 'json').toLowerCase();
  const docs = {
    version: 'v1',
    auth: 'Authorization: Bearer <api_key>  (or ?api_key=<key>)',
    base_url: '/client/v1',
    endpoints: [
      { method: 'POST', path: '/send', body: { from: 'SENDER', to: '919876543210', text: 'Hello', dlr_url: 'https://you.com/dlr (optional)' }, response: '202 { id, client_msg_id, to, status: "submitted" }' },
      { method: 'POST', path: '/send-bulk', body: { from: 'SENDER', to: ['919876543210', '918888888888'], text: 'Hello' }, response: '202 { accepted, invalid, messages: [{ to, id }] } — up to 5000 per request' },
      { method: 'GET', path: '/status/:id', response: '{ message: { id, source, destination, status, error_code, submit_time, dlr_time } }' },
      { method: 'GET', path: '/balance', response: '{ balance, credit_limit, currency }' },
      { method: 'GET', path: '/docs?format=markdown', response: 'this document as markdown' },
    ],
    statuses: 'submitted → delivered / undelivered / expired / rejected / failed',
    errors: { 400: 'invalid payload', 401: 'bad api key', 422: 'account/balance/sender issue', 429: 'over TPS — retry in a second' },
    curl: 'curl -X POST {base}/send -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d \'{"from":"SENDER","to":"919876543210","text":"Hello"}\'',
  };
  if (format === 'markdown' || format === 'md') {
    const md = [
      '# 8xtelSMPP Client API (v1)', '',
      `Auth: \`${docs.auth}\``, '',
      ...docs.endpoints.flatMap((e) => [`## ${e.method} ${docs.base_url}${e.path}`, '', '```json', JSON.stringify(e.body ?? e.response, null, 2), '```', '']),
      `Statuses: ${docs.statuses}`,
    ].join('\n');
    res.type('text/markdown').send(md);
    return;
  }
  res.json(docs);
});

router.get('/balance', async (req, res) => {
  const client = ac(req);
  res.json({
    balance: client.balance,
    credit_limit: client.credit_limit,
    currency: (await queryOne<{ currency: string }>(
      'SELECT currency FROM wallets WHERE client_id=$1', [client.id],
    ))?.currency ?? 'EUR',
  });
});

export default router;
