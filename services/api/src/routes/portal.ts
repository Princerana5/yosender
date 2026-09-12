import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  query, queryOne, getPool, getQueue, QUEUES, checkTps, incrStat,
  analyzeSms, normalizeToGsm, parseDestinations,
  type MessageJob,
} from '@8xtel/core';
import { verifyPortalCredentials, signPortalToken } from '../auth.js';
import { requireAuth, requirePortal } from '../middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();

// ── Portal login (public — client email + password, NOT console users) ──────
router.post('/login', async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const user = await verifyPortalCredentials(body.data.email, body.data.password);
  if (!user) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  res.json({
    token: signPortalToken(user),
    client: { id: user.client_id, name: user.client_name, email: user.email },
  });
});

// Everything below: portal token only, scoped to own client_id ───────────────
router.use(requireAuth, requirePortal);

const cid = (req: { user?: { client_id?: string } }): string => req.user!.client_id!;

// ── Dashboard: balance + today's traffic + recent messages ──────────────────
router.get('/me', async (req, res) => {
  const client = await queryOne<{
    id: string; name: string; status: string; balance: string; credit_limit: string;
    currency: string; tps_limit: number; billing_mode: string;
  }>(
    `SELECT c.id, c.name, c.status, c.balance, c.credit_limit, c.currency, c.tps_limit,
            COALESCE(c.billing_mode,'prepay') AS billing_mode
     FROM clients c WHERE c.id=$1`,
    [cid(req)],
  );
  if (!client) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  const [traffic] = await query<{ today: string; month: string; delivered: string; failed: string }>(
    `SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS today,
            COUNT(*) FILTER (WHERE to_char(created_at,'YYYY-MM') = to_char(now(),'YYYY-MM')) AS month,
            COUNT(*) FILTER (WHERE status='delivered') AS delivered,
            COUNT(*) FILTER (WHERE status IN ('failed','undelivered','expired','rejected')) AS failed
     FROM messages WHERE client_id=$1`,
    [cid(req)],
  );
  const recent = await query(
    `SELECT m.id, m.source, m.destination, m.status, m.created_at, m.client_price,
            co.name AS country_name
     FROM messages m LEFT JOIN countries co ON co.id=m.country_id
     WHERE m.client_id=$1 ORDER BY m.created_at DESC LIMIT 10`,
    [cid(req)],
  );
  res.json({ client, traffic, recent });
});

// ── Send SMS as self (normal route matching — no force overrides) ───────────
const portalSendSchema = z.object({
  source: z.string().min(1).max(21),
  destination: z.string().min(4).max(20).regex(/^[+\d][\d\s-]*$/),
  text: z.string().min(1).max(2000),
});

router.post('/send', async (req, res) => {
  const parsed = portalSendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const { source, destination, text } = parsed.data;
  const client = await queryOne<{
    id: string; status: string; balance: string; credit_limit: string; tps_limit: number;
  }>('SELECT id, status, balance, credit_limit, tps_limit FROM clients WHERE id=$1', [cid(req)]);
  if (!client || client.status !== 'active') {
    res.status(422).json({ error: 'account is not active — contact support' });
    return;
  }
  if (Number(client.balance) + Number(client.credit_limit) <= 0) {
    res.status(422).json({ error: 'insufficient balance — please top up' });
    return;
  }
  if (!(await checkTps(`client:${client.id}`, client.tps_limit))) {
    res.status(429).json({ error: 'sending too fast — try again in a second' });
    return;
  }
  const senderRule = await queryOne<{ status: string }>(
    `SELECT status FROM sender_ids WHERE client_id=$1 AND sender=$2
     ORDER BY country_id NULLS LAST LIMIT 1`,
    [client.id, source],
  );
  if (senderRule && senderRule.status === 'blocked') {
    res.status(422).json({ error: `sender id "${source}" is not allowed on your account` });
    return;
  }
  const internalId = randomUUID();
  const clientMsgId = `p-${internalId.slice(0, 8)}`;
  await getPool().query(
    `INSERT INTO messages (id, client_id, channel, client_msg_id, source, destination, text, data_coding, status)
     VALUES ($1,$2,'sms',$3,$4,$5,$6,0,'submitted')`,
    [internalId, client.id, clientMsgId, source, destination, text],
  );
  const job: MessageJob = {
    internal_id: internalId, client_id: client.id, client_msg_id: clientMsgId,
    channel: 'sms', source, destination, country_id: null, text,
    data_coding: 0, route_id: null, attempts: 0,
  };
  await getQueue(QUEUES.submit).add('submit', job, { jobId: internalId });
  await incrStat('submitted');
  res.status(202).json({ id: internalId, status: 'submitted' });
});

// ── Segment estimate: encoding + segments + cost BEFORE sending ─────────────
router.post('/estimate', async (req, res) => {
  const parsed = z.object({
    text: z.string().min(1).max(2000),
    normalize: z.boolean().optional(),
    numbers: z.number().int().min(1).max(50_000).optional(),
    destination: z.string().max(20).optional(), // sample number → exact route price
    source: z.string().max(21).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  let text = parsed.data.text;
  let normalized = false;
  let changed: string[] = [];
  if (parsed.data.normalize) {
    const n = normalizeToGsm(text);
    if (n.changed.length) {
      text = n.text;
      normalized = true;
      changed = n.changed;
    }
  }
  const seg = analyzeSms(text);
  const count = parsed.data.numbers ?? 1;
  // Exact price when a sample destination is given: resolve the matching route
  // (same priority as the routing worker) and use its price_per_segment.
  let unitPrice = 0;
  let priceSource = 'rate card (floor)';
  if (parsed.data.destination) {
    const digits = parsed.data.destination.replace(/\D/g, '');
    const src = parsed.data.source ?? '';
    const hit = await queryOne<{ price_per_segment: string | null; route_name: string }>(
      `SELECT r.price_per_segment, r.name AS route_name FROM routes r
       LEFT JOIN countries co ON co.id=r.country_id
       WHERE r.status='active' AND r.channel='sms'
         AND (r.client_id IS NULL OR r.client_id=$1::uuid)
         AND (r.country_id IS NULL OR ($2 LIKE COALESCE(co.calling_code,'') || '%'))
         AND (r.prefix IS NULL OR $2 LIKE r.prefix || '%')
         AND (r.sender_id IS NULL OR r.sender_id=$3)
         AND r.price_per_segment IS NOT NULL
       ORDER BY (r.client_id IS NULL), length(COALESCE(r.prefix,'')) DESC LIMIT 1`,
      [cid(req), digits, src],
    );
    if (hit?.price_per_segment !== null && hit?.price_per_segment !== undefined) {
      unitPrice = Number(hit.price_per_segment);
      priceSource = `route ${hit.route_name}`;
    }
  }
  if (!unitPrice) {
    const rate = await queryOne<{ price: string }>(
      `SELECT cr.price FROM client_rates cr JOIN clients c ON c.pricing_profile_id=cr.profile_id
       WHERE c.id=$1 ORDER BY cr.price ASC LIMIT 1`,
      [cid(req)],
    );
    unitPrice = Number(rate?.price ?? 0);
  }
  res.json({
    text,
    encoding: seg.encoding,
    units: seg.units,
    segments: seg.segments,
    chars_left: seg.charsLeft,
    non_gsm_chars: seg.nonGsmChars,
    normalized,
    normalized_chars: changed,
    numbers: count,
    total_segments: seg.segments * count,
    unit_price: unitPrice,
    price_source: priceSource,
    estimated_cost: +(unitPrice * seg.segments * count).toFixed(6),
  });
});

// ── Campaign send: single / bulk / file → one campaign, N messages ──────────
// Same pipeline per number (persist → sms:submit → routing → vendor → DLR →
// billing). Balance is pre-checked against the worst-case estimate.
const campaignSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  source: z.string().min(1).max(21),
  text: z.string().min(1).max(2000),
  normalize: z.boolean().optional(),
  destinations: z.array(z.string().min(4).max(20)).min(1).max(10_000).optional(),
  bulk: z.string().max(1_000_000).optional(), // pasted numbers, any separator
});

async function queueOne(
  clientId: string, campaignId: string, source: string, destination: string,
  text: string, dataCoding: number,
): Promise<{ queued: boolean; reason?: string }> {
  const senderRule = await queryOne<{ status: string }>(
    `SELECT status FROM sender_ids WHERE client_id=$1 AND sender=$2
     ORDER BY country_id NULLS LAST LIMIT 1`,
    [clientId, source],
  );
  if (senderRule && senderRule.status === 'blocked') return { queued: false, reason: 'sender blocked' };
  // operator detail: longest prefix match (NULL where unknown)
  const digits = destination.replace(/\D/g, '');
  const op = await queryOne<{ mcc: string | null; mnc: string | null; operator_name: string | null }>(
    `SELECT NULL AS mcc, NULL AS mnc, operator AS operator_name FROM prefixes
     WHERE $1 LIKE prefix || '%' ORDER BY length(prefix) DESC LIMIT 1`,
    [digits],
  );
  const internalId = randomUUID();
  const clientMsgId = `p-${internalId.slice(0, 8)}`;
  await getPool().query(
    `INSERT INTO messages (id, client_id, campaign_id, channel, client_msg_id, source, destination,
                           text, data_coding, status, mnc, mcc, operator_name)
     VALUES ($1,$2,$3,'sms',$4,$5,$6,$7,$8,'submitted',$9,$10,$11)`,
    [internalId, clientId, campaignId, clientMsgId, source, destination, text, dataCoding,
     op?.mnc ?? null, op?.mcc ?? null, op?.operator_name ?? null],
  );
  const job: MessageJob = {
    internal_id: internalId, client_id: clientId, client_msg_id: clientMsgId,
    channel: 'sms', source, destination, country_id: null, text,
    data_coding: dataCoding, route_id: null, attempts: 0,
  };
  await getQueue(QUEUES.submit).add('submit', job, { jobId: internalId });
  await incrStat('submitted');
  return { queued: true };
}

router.post('/campaigns', async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const rawNumbers = b.destinations ?? [];
  const bulkParsed = b.bulk ? parseDestinations(b.bulk, 10_000) : { numbers: [], invalid: [], truncated: false };
  const seen = new Set(rawNumbers);
  const numbers = [...rawNumbers];
  for (const n of bulkParsed.numbers) {
    if (!seen.has(n)) {
      seen.add(n);
      numbers.push(n);
    }
  }
  if (!numbers.length) {
    res.status(400).json({ error: 'no valid destinations', invalid: bulkParsed.invalid });
    return;
  }
  if (numbers.length > 10_000) {
    res.status(400).json({ error: 'max 10,000 numbers per campaign' });
    return;
  }

  const client = await queryOne<{
    id: string; name: string; status: string; balance: string; credit_limit: string; tps_limit: number;
  }>('SELECT id, name, status, balance, credit_limit, tps_limit FROM clients WHERE id=$1', [cid(req)]);
  if (!client || client.status !== 'active') {
    res.status(422).json({ error: 'account is not active — contact support' });
    return;
  }

  // segment analysis (+ optional normalize)
  let text = b.text;
  if (b.normalize) {
    const n = normalizeToGsm(text);
    if (n.changed.length) text = n.text;
  }
  const seg = analyzeSms(text);
  const dataCoding = seg.encoding === 'unicode' ? 8 : 0;

  // worst-case cost check: cheapest client rate × segments × numbers
  const rate = await queryOne<{ price: string }>(
    `SELECT cr.price FROM client_rates cr JOIN clients c ON c.pricing_profile_id=cr.profile_id
     WHERE c.id=$1 ORDER BY cr.price ASC LIMIT 1`,
    [client.id],
  );
  const unitPrice = Number(rate?.price ?? 0);
  const worstCost = unitPrice * seg.segments * numbers.length;
  if (Number(client.balance) + Number(client.credit_limit) < worstCost) {
    res.status(422).json({
      error: `insufficient balance for ~${numbers.length} × ${seg.segments} segment(s) (≈${worstCost.toFixed(2)}). Top up or reduce numbers.`,
      estimate: { segments: seg.segments, numbers: numbers.length, worst_cost: +worstCost.toFixed(6) },
    });
    return;
  }

  const { rows } = await getPool().query(
    `INSERT INTO campaigns (client_id, name, source, text, encoding, segments, unit_price, total_numbers, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sending') RETURNING id`,
    [client.id, b.name ?? `Campaign ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
     b.source, text, seg.encoding, seg.segments, unitPrice || null, numbers.length],
  );
  const campaignId = rows[0].id as string;

  // Accept EVERYTHING into the queue — never skip on TPS. Delivery is paced
  // downstream by the routing worker's per-client TPS guard (delay + retry),
  // so a 100k file drains steadily instead of dropping 99,990 numbers.
  // Only hard rejections (blocked sender) fail here.
  let accepted = 0;
  const failedNums: Array<{ number: string; reason: string }> = [];
  for (const dest of numbers) {
    const r = await queueOne(client.id, campaignId, b.source, dest, text, dataCoding);
    if (r.queued) accepted++;
    else failedNums.push({ number: dest, reason: r.reason ?? 'rejected' });
  }
  await getPool().query(
    `UPDATE campaigns SET accepted=$1, rejected=$2, status='done' WHERE id=$3`,
    [accepted, numbers.length - accepted, campaignId],
  );
  res.status(202).json({
    campaign_id: campaignId,
    encoding: seg.encoding,
    segments: seg.segments,
    total: numbers.length,
    accepted,
    rejected: numbers.length - accepted,
    failed_numbers: failedNums.slice(0, 100),
    invalid_entries: bulkParsed.invalid,
  });
});

// ── Parse uploaded numbers file (txt/csv) → counts, no send ─────────────────
router.post('/parse-file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'no file — field name "file"' });
    return;
  }
  const name = req.file.originalname.toLowerCase();
  if (!/\.(txt|csv)$/.test(name)) {
    res.status(400).json({ error: 'only .txt / .csv files (save Excel as CSV)' });
    return;
  }
  let raw: string;
  try {
    if (name.endsWith('.csv')) {
      const records = parseCsv(req.file.buffer.toString('utf8'), { skip_empty_lines: true }) as string[][];
      raw = records.map((r) => r[0] ?? '').join('\n');
    } else {
      raw = req.file.buffer.toString('utf8');
    }
  } catch {
    res.status(400).json({ error: 'could not parse file' });
    return;
  }
  const { numbers, invalid, truncated } = parseDestinations(raw, 10_000);
  res.json({ total: numbers.length, numbers: numbers.slice(0, 5000), invalid, truncated });
});

// ── Campaign list + detail report ───────────────────────────────────────────
router.get('/campaigns', async (req, res) => {
  const q = req.query as Record<string, string>;
  const params: unknown[] = [cid(req)];
  let where = 'c.client_id=$1';
  if (q.from) {
    params.push(q.from);
    where += ` AND c.created_at >= $${params.length}`;
  }
  if (q.to) {
    params.push(q.to);
    where += ` AND c.created_at <= $${params.length}`;
  }
  const rows = await query(
    `SELECT c.*,
            (SELECT COUNT(*) FILTER (WHERE status='delivered') FROM messages m WHERE m.campaign_id=c.id) AS live_delivered,
            (SELECT COUNT(*) FILTER (WHERE status IN ('failed','undelivered','expired','rejected')) FROM messages m WHERE m.campaign_id=c.id) AS live_failed
     FROM campaigns c WHERE ${where} ORDER BY c.created_at DESC LIMIT 100`,
    params,
  );
  res.json({ campaigns: rows });
});

router.get('/campaigns/:id', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const rows = await query('SELECT * FROM campaigns WHERE id=$1 AND client_id=$2', [req.params.id, cid(req)]);
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const q = req.query as Record<string, string>;
  const params: unknown[] = [req.params.id];
  let where = 'm.campaign_id=$1';
  if (q.status) {
    params.push(q.status);
    where += ` AND m.status=$${params.length}`;
  }
  if (q.destination) {
    params.push(`%${q.destination}%`);
    where += ` AND m.destination LIKE $${params.length}`;
  }
  const limit = Math.min(Number(q.limit ?? 500), 2000);
  params.push(limit);
  const numbers = await query(
    `SELECT m.destination, m.source, m.text, m.status, m.client_price,
            m.submit_time, m.dlr_time, m.created_at, m.mnc, m.mcc, m.operator_name,
            m.vendor_msg_id, m.error_code, m.error_description,
            co.name AS country_name, co.iso_code,
            d.vendor_status AS operator_status, d.client_status AS final_status
     FROM messages m
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN dlrs d ON d.message_id=m.id
     WHERE ${where} ORDER BY m.created_at LIMIT $${params.length}`,
    params,
  );
  const [mix] = await query<{ delivered: string; failed: string; pending: string }>(
    `SELECT COUNT(*) FILTER (WHERE status='delivered') AS delivered,
            COUNT(*) FILTER (WHERE status IN ('failed','undelivered','expired','rejected')) AS failed,
            COUNT(*) FILTER (WHERE status='submitted') AS pending
     FROM messages WHERE campaign_id=$1`,
    [req.params.id],
  );
  res.json({ campaign: rows[0], mix, numbers });
});

// ── Campaign report as CSV download ─────────────────────────────────────────
router.get('/campaigns/:id/export', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const rows = await query('SELECT * FROM campaigns WHERE id=$1 AND client_id=$2', [req.params.id, cid(req)]);
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const numbers = await query(
    `SELECT m.destination, m.source, m.text, m.status, m.client_price,
            m.submit_time, m.dlr_time, m.mnc, m.mcc, m.operator_name,
            m.vendor_msg_id, m.error_code,
            co.name AS country_name, co.iso_code,
            d.vendor_status AS operator_status
     FROM messages m
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN dlrs d ON d.message_id=m.id
     WHERE m.campaign_id=$1 ORDER BY m.created_at LIMIT 20000`,
    [req.params.id],
  );
  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'destination,sender,content,status,operator_status,country,iso,mnc,mcc,operator,vendor_msg_id,price,error,submitted,delivered\n';
  const lines = (numbers as Record<string, unknown>[]).map((m) =>
    [m.destination, m.source, m.text, m.status, m.operator_status, m.country_name, m.iso_code,
     m.mnc, m.mcc, m.operator_name, m.vendor_msg_id, m.client_price,
     m.error_code ?? m.error_description, m.submit_time, m.dlr_time].map(esc).join(','),
  );
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="campaign-${req.params.id.slice(0, 8)}.csv"`);
  res.send(header + lines.join('\n'));
});

// ── Coverage: routes available to this client + country + rate ──────────────
router.get('/coverage', async (req, res) => {
  const me = await queryOne<{ currency: string }>(
    'SELECT currency FROM clients WHERE id=$1', [cid(req)],
  );
  const walletCurrency = me?.currency ?? 'USD';
  const fx = await query<{ code: string; rate_to_usd: string }>('SELECT code, rate_to_usd FROM fx_rates');
  // CHAR(3) pads codes with spaces — trim before keying
  const toUsd: Record<string, number> = Object.fromEntries(fx.map((f) => [f.code.trim(), Number(f.rate_to_usd)]));
  const convert = (amount: number, from: string): number => {
    const rFrom = toUsd[from] ?? 1;
    const rTo = toUsd[walletCurrency] ?? 1;
    return rTo ? +(amount * rFrom / rTo).toFixed(6) : amount;
  };
  // Routes allotted to this client ONLY: dedicated rows (client_id = me).
  // Global routes are hidden here even though the engine may still use them
  // as fallback at send time — Coverage shows what was opened for this account.
  const routes = await query(
    `SELECT r.id, r.name, r.strategy, r.prefix, r.sender_id,
            r.price_per_segment, COALESCE(r.price_currency,'USD') AS price_currency,
            true AS dedicated,
            co.id AS country_id, co.name AS country_name, co.iso_code, co.calling_code
     FROM routes r LEFT JOIN countries co ON co.id=r.country_id
     WHERE r.status='active' AND r.channel='sms'
       AND r.client_id=$1::uuid
     ORDER BY co.name NULLS LAST, r.name`,
    [cid(req)],
  );
  // Client rate-card fallback rows (cheapest per country/prefix)
  const rates = await query(
    `SELECT cr.price, COALESCE(cr.currency,'USD') AS currency,
            co.id AS country_id, co.name AS country_name, co.iso_code, co.calling_code, cr.prefix
     FROM client_rates cr JOIN clients c ON c.pricing_profile_id=cr.profile_id
     LEFT JOIN countries co ON co.id=cr.country_id
     WHERE c.id=$1 ORDER BY co.name NULLS LAST, length(COALESCE(cr.prefix,'')) DESC`,
    [cid(req)],
  );
  res.json({
    wallet_currency: walletCurrency,
    routes: (routes as Record<string, unknown>[]).map((r) => ({
      ...r,
      price_per_segment: r.price_per_segment !== null && r.price_per_segment !== undefined
        ? convert(Number(r.price_per_segment), String(r.price_currency ?? 'USD'))
        : null,
      price_currency: walletCurrency,
      price_source: r.price_per_segment !== null && r.price_per_segment !== undefined ? 'route' : 'rate card',
    })),
    rate_card: (rates as Record<string, unknown>[]).map((r) => ({
      ...r,
      price: convert(Number(r.price), String(r.currency ?? 'USD')),
      currency: walletCurrency,
    })),
  });
});

// ── Own message history + detail ────────────────────────────────────────────
router.get('/messages', async (req, res) => {
  const q = req.query as Record<string, string>;
  const limit = Math.min(Number(q.limit ?? 50), 200);
  const params: unknown[] = [cid(req)];
  const where = ['m.client_id=$1'];
  if (q.status) {
    params.push(q.status);
    where.push(`m.status=$${params.length}`);
  }
  if (q.destination) {
    params.push(`%${q.destination}%`);
    where.push(`m.destination LIKE $${params.length}`);
  }
  params.push(limit);
  const rows = await query(
    `SELECT m.id, m.source, m.destination, m.text, m.status, m.client_price,
            m.submit_time, m.dlr_time, m.created_at,
            co.name AS country_name
     FROM messages m LEFT JOIN countries co ON co.id=m.country_id
     WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT $${params.length}`,
    params,
  );
  res.json({ messages: rows });
});

router.get('/messages/:id', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // Explicit columns: never expose vendor_id / vendor_cost / internal ids to clients.
  const rows = await query(
    `SELECT m.id, m.source, m.destination, m.text, m.status, m.client_price,
            m.submit_time, m.dlr_time, m.created_at,
            co.name AS country_name
     FROM messages m LEFT JOIN countries co ON co.id=m.country_id
     WHERE m.id=$1 AND m.client_id=$2`,
    [req.params.id, cid(req)],
  );
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const events = await query('SELECT event, detail, created_at FROM message_events WHERE message_id=$1 ORDER BY created_at', [req.params.id]);
  const dlr = await query('SELECT vendor_status, client_status, delivered_at FROM dlrs WHERE message_id=$1', [req.params.id]);
  res.json({ message: rows[0], events, dlr: dlr[0] ?? null });
});

// ── Wallet: balance + own ledger ────────────────────────────────────────────
router.get('/wallet', async (req, res) => {
  const wallet = await queryOne(
    'SELECT w.*, c.name AS client_name FROM wallets w JOIN clients c ON c.id=w.client_id WHERE w.client_id=$1',
    [cid(req)],
  );
  // Financial ledger only — per-message SMS charges are in reports, not here.
  const txs = await query(
    'SELECT type, amount, balance_after, description, remark, created_at FROM transactions WHERE client_id=$1 AND message_id IS NULL ORDER BY created_at DESC LIMIT 100',
    [cid(req)],
  );
  res.json({ wallet, transactions: txs });
});

// ── Top-up requests ─────────────────────────────────────────────────────────
router.get('/topup-requests', async (req, res) => {
  res.json({
    requests: await query('SELECT * FROM topup_requests WHERE client_id=$1 ORDER BY created_at DESC LIMIT 50', [cid(req)]),
  });
});

router.post('/topup-requests', async (req, res) => {
  const parsed = z.object({
    amount: z.number().positive().max(1_000_000),
    note: z.string().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const rows = await query(
    'INSERT INTO topup_requests (client_id, amount, note) VALUES ($1,$2,$3) RETURNING *',
    [cid(req), parsed.data.amount, parsed.data.note ?? null],
  );
  res.status(201).json({ request: rows[0] });
});

// ── Sender-ID requests + approved list ──────────────────────────────────────
router.get('/senders', async (req, res) => {
  const approved = await query(
    `SELECT s.sender, s.status, c.name AS country_name FROM sender_ids s
     LEFT JOIN countries c ON c.id=s.country_id WHERE s.client_id=$1 ORDER BY s.sender`,
    [cid(req)],
  );
  const requests = await query(
    `SELECT sr.*, c.name AS country_name FROM sender_requests sr
     LEFT JOIN countries c ON c.id=sr.country_id WHERE sr.client_id=$1 ORDER BY sr.created_at DESC LIMIT 50`,
    [cid(req)],
  );
  res.json({ senders: approved, requests });
});

router.post('/sender-requests', async (req, res) => {
  const parsed = z.object({
    sender: z.string().min(1).max(21),
    country_id: z.string().uuid().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const rows = await query(
    'INSERT INTO sender_requests (client_id, sender, country_id) VALUES ($1,$2,$3) RETURNING *',
    [cid(req), parsed.data.sender, parsed.data.country_id ?? null],
  );
  res.status(201).json({ request: rows[0] });
});

export default router;
