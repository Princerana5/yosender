import { Router } from 'express';
import { z } from 'zod';
import crypto, { randomUUID } from 'node:crypto';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  query, queryOne, getPool, getQueue, QUEUES, tryAcquireTps, incrStat, submitQueueFor, getAnyQueue, trackBulkClient, getRedis,
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
  if (!(await tryAcquireTps(`client:${client.id}`, client.tps_limit))) {
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
  const job = {
    internal_id: internalId, client_id: client.id, client_msg_id: clientMsgId,
    channel: 'sms', source, destination, country_id: null, text,
    data_coding: 0, route_id: null, attempts: 0,
    _bulk: false,
  } as MessageJob & { _bulk: boolean };
  await getAnyQueue(submitQueueFor(job)).add('submit', job as never, { jobId: internalId });
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
         AND (
           NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id)
           OR EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id AND rc.client_id=$1::uuid)
         )
         AND NOT EXISTS (
           SELECT 1 FROM route_client_exclusions x
           WHERE x.route_id=r.id AND x.client_id=$1::uuid
         )
         AND (r.country_id IS NULL OR ($2 LIKE COALESCE(co.calling_code,'') || '%'))
         AND (r.prefix IS NULL OR $2 LIKE r.prefix || '%')
         AND (r.sender_id IS NULL OR r.sender_id=$3)
         AND r.price_per_segment IS NOT NULL
       ORDER BY (NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id)), length(COALESCE(r.prefix,'')) DESC LIMIT 1`,
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
  const job = {
    internal_id: internalId, client_id: clientId, client_msg_id: clientMsgId,
    channel: 'sms', source, destination, country_id: null, text,
    data_coding: dataCoding, route_id: null, attempts: 0,
    _bulk: true,
  } as MessageJob & { _bulk: boolean };
  await getAnyQueue(submitQueueFor(job)).add('submit', job as never, { jobId: internalId });
  await trackBulkClient(clientId);
  getRedis().publish('bulk:hint', clientId).catch(()=>undefined);
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

// ── Country-wise summary: totals per country for today / yesterday ─────────
// Scoped to the logged-in client. ?day=today (default) | yesterday.
// Used by the portal Reports page for the country table + CSV download.
router.get('/summary', async (req, res) => {
  const q = req.query as Record<string, string>;
  const day = q.day === 'yesterday' ? 'yesterday' : 'today';
  const timeFilter = day === 'yesterday'
    ? `m.created_at >= (CURRENT_DATE - interval '1 day') AND m.created_at < CURRENT_DATE`
    : `m.created_at >= CURRENT_DATE`;
  const rows = await query(
    `SELECT COALESCE(co.name, 'Unknown') AS country, COALESCE(co.iso_code, '—') AS iso_code,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE m.status='delivered') AS delivered,
            COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered','expired','rejected')) AS failed,
            COUNT(*) FILTER (WHERE m.status='submitted') AS pending
     FROM messages m
     LEFT JOIN countries co ON co.id=m.country_id
     WHERE m.client_id=$1 AND ${timeFilter}
     GROUP BY 1,2 ORDER BY total DESC`,
    [cid(req)],
  );
  res.json({ day, summary: rows });
});

// ── Full detail report as CSV download (?day=today|yesterday, ?country=) ────
// One row per message: destination, sender, content, status, operator DLR,
// country, MCC/MNC/operator, vendor id, cost, error, submit + DLR time.
// Optional ?country=<iso or name> filters to one country. Capped at 50k rows.
router.get('/summary/export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const day = q.day === 'yesterday' ? 'yesterday' : 'today';
  const timeFilter = day === 'yesterday'
    ? `m.created_at >= (CURRENT_DATE - interval '1 day') AND m.created_at < CURRENT_DATE`
    : `m.created_at >= CURRENT_DATE`;
  const params: unknown[] = [cid(req)];
  let countryFilter = '';
  if (q.country) {
    params.push(q.country);
    countryFilter = ` AND (co.iso_code ILIKE $${params.length} OR co.name ILIKE $${params.length})`;
  }
  const numbers = await query<Record<string, unknown>>(
    `SELECT m.destination, m.source, m.text, m.status, m.client_price,
            m.submit_time, m.dlr_time, m.created_at, m.mnc, m.mcc, m.operator_name,
            m.vendor_msg_id, m.error_code, m.error_description,
            co.name AS country_name, co.iso_code,
            d.vendor_status AS operator_status, d.client_status AS final_status
     FROM messages m
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN dlrs d ON d.message_id=m.id
     WHERE m.client_id=$1 AND ${timeFilter}${countryFilter}
     ORDER BY m.created_at LIMIT 50000`,
    params,
  );
  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'destination,sender,content,status,operator_status,final_status,country,iso_code,mcc,mnc,operator,vendor_msg_id,cost,error,submitted,delivered,created\n';
  const lines = numbers.map((m) =>
    [m.destination, m.source, m.text, m.status, m.operator_status, m.final_status,
     m.country_name, m.iso_code, m.mcc, m.mnc, m.operator_name, m.vendor_msg_id,
     m.client_price, m.error_code ?? m.error_description,
     m.submit_time, m.dlr_time, m.created_at].map(esc).join(','),
  );
  const suffix = q.country ? `-${String(q.country).toLowerCase().replace(/[^a-z0-9]+/g, '')}` : '';
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="full-report-${day}${suffix}.csv"`);
  res.send(header + lines.join('\n'));
});

// ── Coverage: routes available to this client + country + rate ──────────────
router.get('/coverage', async (req, res) => {
  const me = await queryOne<{ currency: string }>(
    'SELECT currency FROM clients WHERE id=$1', [cid(req)],
  );
  const walletCurrency = me?.currency ?? 'EUR';
  const fx = await query<{ code: string; rate_to_usd: string }>('SELECT code, rate_to_usd FROM fx_rates');
  // CHAR(3) pads codes with spaces — trim before keying
  const toUsd: Record<string, number> = Object.fromEntries(fx.map((f) => [f.code.trim(), Number(f.rate_to_usd)]));
  const convert = (amount: number, from: string): number => {
    const rFrom = toUsd[from] ?? 1;
    const rTo = toUsd[walletCurrency] ?? 1;
    return rTo ? +(amount * rFrom / rTo).toFixed(6) : amount;
  };
  // Routes serving this client: member routes (I'm listed) PLUS global
  // fallback rows (no members) — mirrors the routing engine's candidate
  // set, so Coverage shows every route the client can actually send on.
  const routes = await query(
    `SELECT r.id, r.name, r.strategy, r.prefix, r.sender_id,
            r.price_per_segment, COALESCE(r.price_currency,'EUR') AS price_currency,
            EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id AND rc.client_id=$1::uuid) AS dedicated,
            co.id AS country_id, co.name AS country_name, co.iso_code, co.calling_code
     FROM routes r LEFT JOIN countries co ON co.id=r.country_id
     WHERE r.status='active' AND r.channel='sms'
       AND (
         NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id)
         OR EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id AND rc.client_id=$1::uuid)
       )
       AND NOT EXISTS (
         SELECT 1 FROM route_client_exclusions x
         WHERE x.route_id=r.id AND x.client_id=$1::uuid
       )
     ORDER BY (NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id)), co.name NULLS LAST, r.name`,
    [cid(req)],
  );
  // Client rate-card fallback rows (cheapest per country/prefix)
  const rates = await query(
    `SELECT cr.price, COALESCE(cr.currency,'EUR') AS currency,
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
        ? convert(Number(r.price_per_segment), String(r.price_currency ?? 'EUR'))
        : null,
      price_currency: walletCurrency,
      price_source: r.price_per_segment !== null && r.price_per_segment !== undefined ? 'route' : 'rate card',
    })),
    rate_card: (rates as Record<string, unknown>[]).map((r) => ({
      ...r,
      price: convert(Number(r.price), String(r.currency ?? 'EUR')),
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

// ── Invoices (own client only) ─────────────────────────────────────────────
router.get('/payment-methods', async (_req, res) => {
  const rows = await query('SELECT id, kind, label, chain, details, sort_order FROM system_payment_methods WHERE is_active=true ORDER BY sort_order, created_at');
  res.json({ methods: rows });
});

router.get('/invoices', async (req, res) => {
  const id = cid(req);
  const rows = await query('SELECT * FROM invoices WHERE client_id=$1 ORDER BY created_at DESC LIMIT 100', [id]);
  res.json({ invoices: rows });
});
router.get('/invoices/:invId', async (req, res) => {
  const inv = await query('SELECT * FROM invoices WHERE id=$1::uuid AND client_id=$2', [req.params.invId, cid(req)]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  const lines = await query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY amount DESC', [req.params.invId]);
  const emails = await query('SELECT * FROM invoice_emails WHERE invoice_id=$1 ORDER BY sent_at DESC', [req.params.invId]);
  const payments = await query('SELECT * FROM invoice_payments WHERE invoice_id=$1::uuid ORDER BY created_at DESC', [req.params.invId]).catch(() => []);
  const methods = await query('SELECT id, kind, label, chain, details FROM system_payment_methods WHERE is_active=true ORDER BY sort_order').catch(() => []);
  res.json({ invoice: inv[0], lines, emails, payments, payment_methods: methods });
});
router.get('/invoices/:invId/payments', async (req, res) => {
  const inv = await query('SELECT id FROM invoices WHERE id=$1::uuid AND client_id=$2', [req.params.invId, cid(req)]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  const rows = await query('SELECT * FROM invoice_payments WHERE invoice_id=$1::uuid ORDER BY created_at DESC', [req.params.invId]);
  res.json({ payments: rows });
});
router.post('/invoices/:invId/payment', async (req, res) => {
  const parsed = z.object({
    method: z.enum(['bank','upi','usdt','wire','other']),
    chain: z.enum(['TRC20','ERC20','BEP20','Polygon','Other']).nullable().optional(),
    details: z.record(z.unknown()).default({}),
    amount: z.number().optional(),
    reference: z.string().max(200).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  if (parsed.data.method === 'usdt' && !parsed.data.chain) { res.status(422).json({ error: 'chain is required for usdt' }); return; }
  const inv = await query('SELECT id FROM invoices WHERE id=$1::uuid AND client_id=$2', [req.params.invId, cid(req)]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  const details = { ...parsed.data.details as Record<string, unknown>, ...(parsed.data.reference ? { reference: parsed.data.reference } : {}) };
  const { rows } = await getPool().query(
    `INSERT INTO invoice_payments (invoice_id, method, chain, details, amount, status) VALUES ($1::uuid,$2,$3,$4,$5,'pending') RETURNING *`,
    [req.params.invId, parsed.data.method, parsed.data.chain ?? null, JSON.stringify(details), parsed.data.amount ?? null],
  );
  await getPool().query('UPDATE invoices SET payment_method=$1, payment_chain=$2, updated_at=now() WHERE id=$3::uuid', [parsed.data.method, parsed.data.chain ?? null, req.params.invId]);
  res.status(201).json({ payment: rows[0] });
});
router.get('/invoices/:invId/pdf', async (req, res) => {
  const inv = await query('SELECT i.*, c.name AS client_name, c.company_name, c.system_id, c.portal_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=$1::uuid AND i.client_id=$2', [req.params.invId, cid(req)]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  const lines = await query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY amount DESC', [req.params.invId]);
  const methods = await query('SELECT kind, label, chain, details FROM system_payment_methods WHERE is_active=true ORDER BY sort_order').catch(() => []);
  const { buildInvoiceHtml, buildInvoicePdfBuffer } = await import('../lib/invoice-pdf.js');
  const doc = {
    invoice_number: (inv[0] as { invoice_number: string }).invoice_number,
    period_from: String((inv[0] as { period_from: string }).period_from).slice(0, 10),
    period_to: String((inv[0] as { period_to: string }).period_to).slice(0, 10),
    currency: (inv[0] as { currency: string }).currency,
    subtotal: Number((inv[0] as { subtotal: string }).subtotal),
    tax_rate: Number((inv[0] as { tax_rate: string }).tax_rate),
    tax_amount: Number((inv[0] as { tax_amount: string }).tax_amount),
    adjustments: Number((inv[0] as { adjustments: string }).adjustments),
    grand_total: Number((inv[0] as { grand_total: string }).grand_total),
    status: (inv[0] as { status: string }).status,
    notes: (inv[0] as { notes: string | null }).notes,
    created_at: String((inv[0] as { created_at: string }).created_at),
    client: { name: (inv[0] as { client_name: string }).client_name, company_name: (inv[0] as { company_name: string | null }).company_name, system_id: (inv[0] as { system_id: string }).system_id, email: (inv[0] as { portal_email: string | null }).portal_email },
    lines: (lines as Record<string, unknown>[]).map((l) => ({ country_name: String(l.country_name), iso_code: l.iso_code as string | null, total_sms: Number(l.total_sms), successful: Number(l.successful), failed: Number(l.failed), rejected: Number((l as Record<string, unknown>).rejected ?? 0), segments: Number(l.segments), rate: Number(l.rate), amount: Number(l.amount), percentage: Number(l.percentage) })),
  };
  const payForDoc = (methods as Record<string, unknown>[]).map(m => ({ kind: String(m.kind), label: String(m.label), chain: m.chain as string | null, details: (typeof m.details === 'string' ? JSON.parse(m.details as string) : m.details) as Record<string, unknown> }));
  const wantsPdf = String(req.query.format ?? 'pdf') !== 'html';
  if (wantsPdf) {
    try {
      const pdf = await buildInvoicePdfBuffer(doc, payForDoc);
      const isPdf = pdf[0] === 0x25 && pdf[1] === 0x50;
      if (isPdf) { res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', `inline; filename="Invoice_${doc.invoice_number}.pdf"`); res.send(pdf); return; }
    } catch { /* fallback */ }
  }
  const html = buildInvoiceHtml(doc, payForDoc);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('content-disposition', `inline; filename="${doc.invoice_number}.html"`);
  res.send(Buffer.from(html, 'utf8'));
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

// ── Connect via API: self-serve keys for /client/v1/* ───────────────────────
// Same table the admin console manages (client_api_keys). Plaintext shown
// ONCE at creation; only sha256 stored. Scoped to own client_id.
router.get('/api-keys', async (req, res) => {
  const rows = await query(
    `SELECT id, key_prefix, label, is_active, last_used_at, created_at
     FROM client_api_keys WHERE client_id=$1 ORDER BY created_at DESC`,
    [cid(req)],
  );
  res.json({ keys: rows });
});

router.post('/api-keys', async (req, res) => {
  const parsed = z.object({ label: z.string().max(100).optional() }).safeParse(req.body ?? {});
  const label = parsed.success ? (parsed.data.label ?? null) : null;
  const plain = `x8_${crypto.randomBytes(24).toString('base64url')}`;
  const keyHash = crypto.createHash('sha256').update(plain).digest('hex');
  const { rows } = await getPool().query(
    `INSERT INTO client_api_keys (client_id, key_hash, key_prefix, label)
     VALUES ($1,$2,$3,$4) RETURNING id, key_prefix, label, created_at`,
    [cid(req), keyHash, plain.slice(0, 11), label],
  );
  res.status(201).json({ key: { ...rows[0], value: plain } });
});

router.patch('/api-keys/:keyId', async (req, res) => {
  if (typeof req.body?.is_active !== 'boolean') {
    res.status(400).json({ error: 'provide body.is_active boolean' });
    return;
  }
  const rows = await query(
    'UPDATE client_api_keys SET is_active=$1 WHERE id=$2 AND client_id=$3 RETURNING id, is_active',
    [req.body.is_active, req.params.keyId, cid(req)],
  );
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ key: rows[0] });
});

// Markdown integration doc for the portal (portal token, no API key needed)
router.get('/api-docs', async (_req, res) => {
  const md = [
    '# 8xtelSMPP Client HTTP API (v1)', '',
    'Send SMS over HTTPS, check status, check balance, receive delivery callbacks.', '',
    '## 1. Authentication', '',
    'Create a key in the portal (API tab → + New key). Send it on every request:', '',
    '```http', 'Authorization: Bearer <api_key>', '```', '',
    'Alternative: `?api_key=<key>` as a query param. Keep keys secret — anyone with',
    'a key can spend your balance. Disable / revoke unused keys in the portal.', '',
    '## 2. Base URL', '',
    '```', '{PANEL}/api/client/v1', '```', '',
    'Replace `{PANEL}` with your panel origin (shown in the portal samples).', '',
    '## 3. Send one SMS', '',
    '```http', 'POST /client/v1/send', 'Content-Type: application/json', 'Authorization: Bearer <api_key>', '',
    '{', '  "from": "SENDER",', '  "to": "919876543210",', '  "text": "Hello via API",', '  "dlr_url": "https://you.com/dlr (optional, stored as your default)"', '}', '```', '',
    'Success `202`:', '',
    '```json', '{ "id": "<message-id>", "client_msg_id": "h-xxxxxxxx", "to": "919876543210", "status": "submitted" }', '```', '',
    'Save `id` — you need it for status checks and it arrives back in callbacks.', '',
    '## 4. Send bulk (up to 5000 per request)', '',
    '```http', 'POST /client/v1/send-bulk', 'Content-Type: application/json', 'Authorization: Bearer <api_key>', '',
    '{', '  "from": "SENDER",', '  "to": ["919876543210", "918888888888"],', '  "text": "Hello"', '}', '```', '',
    '`to` also accepts a comma/space/newline separated string. Success `202`:', '',
    '```json', '{ "accepted": 2, "invalid": [], "messages": [{ "to": "919876543210", "id": "<message-id>" }] }', '```', '',
    '## 5. Delivery status', '',
    '```http', 'GET /client/v1/status/:id', 'Authorization: Bearer <api_key>', '```', '',
    '```json', '{ "message": { "id": "...", "source": "SENDER", "destination": "919876543210", "status": "delivered", "error_code": null, "submit_time": "...", "dlr_time": "..." } }', '```', '',
    'Statuses: `submitted` → `delivered` / `undelivered` / `expired` / `rejected` / `failed`.',
    'Poll this endpoint, or (better) use callbacks below for push updates.', '',
    '## 6. Balance', '',
    '```http', 'GET /client/v1/balance', 'Authorization: Bearer <api_key>', '```', '',
    '```json', '{ "balance": "12.50", "credit_limit": "0", "currency": "EUR" }', '```', '',
    '## 7. Delivery callbacks (DLR push to you)', '',
    'Pass `dlr_url` on any send (or ask support to set a default). We POST JSON to',
    'that URL on EVERY status change until a final state:', '',
    '```json', '{ "message_id": "<id from send>", "vendor_msg_id": "<upstream id or null>", "status": "delivered", "ts": "2026-01-01T00:00:00.000Z" }', '```', '',
    '- Method: `POST`, body: JSON, `Content-Type: application/json`.',
    '- Your endpoint must answer HTTP `2xx` within ~10s. Anything else → we retry with backoff.',
    '- Match on `message_id` (our id returned by /send). `status` is one of the values in §5.',
    '- Tip: reply `200` immediately, then process async — avoids duplicate retries.',
    '- PHP receiver example:', '',
    '```php', '<?php', '$dlr = json_decode(file_get_contents("php://input"), true);',
    '// $dlr["message_id"], $dlr["status"], $dlr["ts"] → update your DB', 'http_response_code(200);', '```', '',
    '## 8. Errors', '',
    '| Code | Meaning |',
    '|------|---------|',
    '| 400 | invalid payload / no valid destinations |',
    '| 401 | missing or bad api key |',
    '| 422 | account not active, insufficient balance, sender id blocked |',
    '| 429 | over your TPS limit — wait a second and retry |',
    '',
    'Guards mirror portal sends: active account, balance/credit, TPS, blocked sender ids.',
    'Accepted messages flow through the same pipeline (routing → vendor → DLR → billing).',
  ].join('\n');
  res.type('text/markdown').send(md);
});

router.delete('/api-keys/:keyId', async (req, res) => {
  const r = await getPool().query(
    'DELETE FROM client_api_keys WHERE id=$1 AND client_id=$2', [req.params.keyId, cid(req)],
  );
  if (!r.rowCount) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
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

// ── RCS (portal) — separate channel, separate wallet/queues ─────────────
// Auth is portal JWT (requirePortal above), not RCS API keys. Rich content
// (text / rich_card / carousel) uses rcsContent schema; billing is via
// rcs_wallets + rcs_billing_reservations + rcs_outbox → rcs-route.
const rcsContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(4096) }),
  z.object({
    type: z.literal('rich_card'), title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    media_url: z.string().url().max(2048).optional(),
    suggestions: z.array(z.object({
      type: z.enum(['reply', 'open_url', 'dial', 'view_location']),
      text: z.string().min(1).max(80),
      url: z.string().url().max(2048).optional(),
      phone_number: z.string().max(32).optional(),
    })).max(10).default([]),
  }),
  z.object({
    type: z.literal('carousel'),
    cards: z.array(z.object({
      title: z.string().min(1).max(200), description: z.string().max(2000).optional(),
      media_url: z.string().url().max(2048).optional(),
      suggestions: z.array(z.object({
        type: z.enum(['reply', 'open_url', 'dial', 'view_location']),
        text: z.string().min(1).max(80),
        url: z.string().url().max(2048).optional(),
        phone_number: z.string().max(32).optional(),
      })).max(10).default([]),
    })).min(1).max(10),
  }),
]);

function normalizeRcsDest(v: string): string | null {
  const t = v.trim().replace(/[\s().-]/g, '');
  if (!/^\+?[1-9]\d{6,14}$/.test(t)) return null;
  return t.startsWith('+') ? t : `+${t}`;
}

router.get('/rcs/me', async (req, res) => {
  const id = cid(req);
  const me = await queryOne<{ rcs_enabled: boolean; balance: string; reserved: string; currency: string }>(
    `SELECT COALESCE(c.rcs_enabled,false) AS rcs_enabled,
            COALESCE(w.balance,0)::text AS balance, COALESCE(w.reserved,0)::text AS reserved,
            COALESCE(w.currency,'USD') AS currency
     FROM clients c LEFT JOIN rcs_wallets w ON w.client_id=c.id WHERE c.id=$1`, [id],
  );
  res.json({ rcs_enabled: me?.rcs_enabled ?? false, wallet: me ?? { balance: '0', reserved: '0', currency: 'USD' } });
});

router.get('/rcs/senders', async (req, res) => {
  const rows = await query(
    `SELECT s.sender, s.status, s.country_id, co.name AS country_name
     FROM rcs_senders s LEFT JOIN countries co ON co.id=s.country_id
     WHERE s.client_id=$1 ORDER BY s.sender`, [cid(req)],
  );
  res.json({ senders: rows });
});

router.post('/rcs/estimate', async (req, res) => {
  const p = z.object({
    content: rcsContentSchema, recipients: z.number().int().min(1).max(50000).optional(),
    to: z.string().optional(),
  }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid payload', details: p.error.flatten() }); return; }
  const count = p.data.recipients ?? 1;
  const size = Buffer.byteLength(JSON.stringify(p.data.content));
  const limit = await queryOne<{ v: string }>(`SELECT (value#>>'{}') AS v FROM rcs_settings WHERE key='max_content_bytes'`);
  const maxBytes = Number(limit?.v ?? 32768);
  if (size > maxBytes) { res.status(413).json({ error: `content too large (${size} > ${maxBytes} bytes)` }); return; }
  // cheapest rate for this client (country-agnostic estimate; precise per-number is after country resolve)
  const rate = await queryOne<{ price: string }>(
    `SELECT min(price)::text AS price FROM rcs_rates WHERE client_id=$1 AND effective_from<=now()`, [cid(req)],
  );
  const unit = Number(rate?.price ?? 0);
  res.json({ size_bytes: size, max_bytes: maxBytes, recipients: count, unit_price: unit, estimated_cost: +(unit * count).toFixed(6) });
});

async function createPortalRcsMessage(opts: {
  clientId: string; from: string; to: string; content: unknown;
  idempotencyKey?: string; clientMessageId?: string;
}): Promise<{ id: string; status: string; duplicate: boolean; price: string }> {
  const norm = normalizeRcsDest(opts.to);
  if (!norm) throw Object.assign(new Error('destination must be E.164'), { status: 400, code: 'INVALID_DESTINATION' });
  const contentParsed = rcsContentSchema.safeParse(opts.content);
  if (!contentParsed.success) throw Object.assign(new Error('invalid RCS content'), { status: 400 });
  const size = Buffer.byteLength(JSON.stringify(contentParsed.data));
  const lim = await queryOne<{ v: string }>(`SELECT (value#>>'{}') AS v FROM rcs_settings WHERE key='max_content_bytes'`);
  if (size > Number(lim?.v ?? 32768)) throw Object.assign(new Error('content too large'), { status: 413 });
  const sender = await queryOne<{ status: string }>(`SELECT status FROM rcs_senders WHERE client_id=$1 AND sender=$2 ORDER BY country_id NULLS LAST LIMIT 1`, [opts.clientId, opts.from]);
  if (!sender || sender.status !== 'approved') throw Object.assign(new Error('sender not approved for RCS'), { status: 422 });
  const enabled = await queryOne<{ rcs_enabled: boolean }>(`SELECT rcs_enabled FROM clients WHERE id=$1`, [opts.clientId]);
  if (!enabled?.rcs_enabled) throw Object.assign(new Error('RCS not enabled for this account'), { status: 403 });
  const country = await queryOne<{ id: string }>(`SELECT id FROM countries WHERE status='active' AND $1 LIKE '+'||calling_code||'%' ORDER BY length(calling_code) DESC LIMIT 1`, [norm]);
  if (!country) throw Object.assign(new Error('unsupported destination country'), { status: 422 });
  const db = getPool(); const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    if (opts.idempotencyKey) {
      const ex = await tx.query(`SELECT id,status,price::text AS price FROM rcs_messages WHERE client_id=$1 AND idempotency_key=$2`, [opts.clientId, opts.idempotencyKey]);
      if (ex.rowCount) { await tx.query('COMMIT'); return { id: ex.rows[0].id, status: ex.rows[0].status, duplicate: true, price: ex.rows[0].price }; }
    }
    const rate = await tx.query(`SELECT price::text AS price FROM rcs_rates WHERE client_id=$1 AND country_id=$2 AND effective_from<=now() ORDER BY effective_from DESC LIMIT 1`, [opts.clientId, country.id]);
    if (!rate.rowCount) throw Object.assign(new Error('RCS rate not configured for this destination'), { status: 422 });
    const price = String(rate.rows[0].price);
    const wallet = await tx.query(`SELECT balance, reserved, credit_limit FROM rcs_wallets WHERE client_id=$1 FOR UPDATE`, [opts.clientId]);
    if (!wallet.rowCount) {
      await tx.query(`INSERT INTO rcs_wallets(client_id, currency) VALUES($1,'USD') ON CONFLICT(client_id) DO NOTHING`, [opts.clientId]);
      throw Object.assign(new Error('RCS wallet is empty — ask admin to credit RCS balance'), { status: 422 });
    }
    const w = wallet.rows[0];
    if (Number(w.balance) - Number(w.reserved) + Number(w.credit_limit) < Number(price)) throw Object.assign(new Error('insufficient RCS balance'), { status: 422 });
    const msgId = randomUUID();
    const ins = await tx.query(
      `INSERT INTO rcs_messages(id, client_id, client_message_id, idempotency_key, sender, destination, country_id, content, status, price)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9) ON CONFLICT(client_id, idempotency_key) DO NOTHING RETURNING id,status,price::text AS price`,
      [msgId, opts.clientId, opts.clientMessageId ?? null, opts.idempotencyKey ?? null, opts.from, norm, country.id, JSON.stringify(contentParsed.data), price],
    );
    if (!ins.rowCount) {
      const ex = await tx.query(`SELECT id,status,price::text AS price FROM rcs_messages WHERE client_id=$1 AND idempotency_key=$2`, [opts.clientId, opts.idempotencyKey]);
      await tx.query('COMMIT'); return { id: ex.rows[0].id, status: ex.rows[0].status, duplicate: true, price: ex.rows[0].price };
    }
    const rv = await tx.query(`INSERT INTO rcs_billing_reservations(client_id, message_id, amount) VALUES($1,$2,$3) RETURNING id`, [opts.clientId, msgId, price]);
    const upd = await tx.query(`UPDATE rcs_wallets SET reserved=reserved+$1, updated_at=now() WHERE client_id=$2 RETURNING balance, reserved`, [price, opts.clientId]);
    await tx.query(`INSERT INTO rcs_ledger(client_id, reservation_id, message_id, type, amount, balance_after, reserved_after, event_key) VALUES($1,$2,$3,'reserve',$4,$5,$6,$7)`,
      [opts.clientId, rv.rows[0].id, msgId, price, upd.rows[0].balance, upd.rows[0].reserved, `reserve:${msgId}`]);
    await tx.query(`INSERT INTO rcs_outbox(message_id, queue_name, dispatch_key) VALUES($1,'rcs-route','initial') ON CONFLICT DO NOTHING`, [msgId]);
    await tx.query('COMMIT');
    // publish — best effort; outbox poller will also dispatch
    const { getRcsQueue, RCS_QUEUES: RQ } = await import('@8xtel/core');
    await getRcsQueue(RQ.route).add('route', { message_id: msgId }, { jobId: `${msgId}:outbox:initial` }).catch(() => undefined);
    return { id: msgId, status: 'queued', duplicate: false, price };
  } catch (e) { await tx.query('ROLLBACK').catch(() => undefined); throw e; } finally { tx.release(); }
}

router.post('/rcs/send', async (req, res) => {
  const p = z.object({
    from: z.string().min(1).max(40), to: z.string().min(7).max(20),
    content: rcsContentSchema,
    idempotency_key: z.string().min(8).max(128).optional(),
    client_message_id: z.string().max(128).optional(),
  }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid payload', details: p.error.flatten() }); return; }
  try { const r = await createPortalRcsMessage({ clientId: cid(req), from: p.data.from, to: p.data.to, content: p.data.content, idempotencyKey: p.data.idempotency_key, clientMessageId: p.data.client_message_id }); res.status(r.duplicate ? 200 : 202).json(r); }
  catch (e) { const err = e as Error & { status?: number }; res.status(err.status ?? 500).json({ error: err.message }); }
});

router.post('/rcs/campaigns', async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(160).optional(),
    from: z.string().min(1).max(40), content: rcsContentSchema,
    recipients: z.array(z.string().min(1)).min(1).max(10000).optional(),
    bulk: z.string().max(1_000_000).optional(),
    destinations: z.array(z.string().min(1)).min(1).max(10000).optional(),
  });
  const p = schema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'invalid payload', details: p.error.flatten() }); return; }
  const rawList = p.data.recipients ?? p.data.destinations ?? [];
  const bulkExtra = p.data.bulk ? p.data.bulk.split(/[,;\s\n\r\t|]+/).filter(Boolean) : [];
  const seen = new Set<string>(); const all = [...rawList, ...bulkExtra].filter((v) => { const k = v.trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  if (!all.length) { res.status(400).json({ error: 'no recipients' }); return; }
  const senderOk = await queryOne<{ status: string }>(`SELECT status FROM rcs_senders WHERE client_id=$1 AND sender=$2 ORDER BY country_id NULLS LAST LIMIT 1`, [cid(req), p.data.from]);
  if (!senderOk || senderOk.status !== 'approved') { res.status(422).json({ error: 'sender not approved for RCS' }); return; }
  const enabled = await queryOne<{ rcs_enabled: boolean }>(`SELECT rcs_enabled FROM clients WHERE id=$1`, [cid(req)]);
  if (!enabled?.rcs_enabled) { res.status(403).json({ error: 'RCS not enabled' }); return; }
  const size = Buffer.byteLength(JSON.stringify(p.data.content));
  const lim = await queryOne<{ v: string }>(`SELECT (value#>>'{}') AS v FROM rcs_settings WHERE key='max_content_bytes'`);
  if (size > Number(lim?.v ?? 32768)) { res.status(413).json({ error: 'content too large' }); return; }
  // validate + classify recipients
  const rows: Array<{ destination: string; state: string; reason: string | null }> = [];
  const seenNorm = new Set<string>();
  for (const orig of all) {
    const norm = normalizeRcsDest(orig);
    if (!orig.trim()) { rows.push({ destination: '', state: 'empty', reason: 'empty' }); continue; }
    if (seenNorm.has(norm ?? orig)) { rows.push({ destination: orig.trim(), state: 'duplicate', reason: 'duplicate' }); continue; }
    seenNorm.add(norm ?? orig);
    if (!norm) { rows.push({ destination: orig.trim(), state: 'invalid', reason: 'invalid E.164' }); continue; }
    const co = await queryOne<{ id: string }>(`SELECT id FROM countries WHERE status='active' AND $1 LIKE '+'||calling_code||'%' ORDER BY length(calling_code) DESC LIMIT 1`, [norm]);
    rows.push(co ? { destination: norm, state: 'valid', reason: null } : { destination: norm, state: 'unsupported_country', reason: 'country not supported' });
  }
  const valid = rows.filter((r) => r.state === 'valid');
  if (!valid.length) { res.status(422).json({ error: 'no valid recipients', summary: { total: rows.length, valid: 0 } }); return; }
  const rate = await queryOne<{ price: string }>(`SELECT max(price)::text AS price FROM rcs_rates WHERE client_id=$1 AND effective_from<=now()`, [cid(req)]);
  if (!rate?.price) { res.status(422).json({ error: 'RCS rates not configured' }); return; }
  const total = (Number(rate.price) * valid.length).toFixed(6);
  const pool = getPool(); const tx = await pool.connect(); let campaignId = '';
  try {
    await tx.query('BEGIN');
    const w = await tx.query(`SELECT balance, reserved, credit_limit FROM rcs_wallets WHERE client_id=$1 FOR UPDATE`, [cid(req)]);
    if (!w.rowCount) {
      await tx.query(`INSERT INTO rcs_wallets(client_id, currency) VALUES($1,'USD') ON CONFLICT(client_id) DO NOTHING`, [cid(req)]);
      throw Object.assign(new Error('RCS wallet is empty — ask admin to credit RCS balance'), { status: 422 });
    }
    if (Number(w.rows[0].balance) - Number(w.rows[0].reserved) + Number(w.rows[0].credit_limit) < Number(total)) throw Object.assign(new Error('insufficient RCS balance'), { status: 422 });
    const ins = await tx.query(
      `INSERT INTO rcs_campaigns(client_id, name, sender, content, status, recipient_count, accepted_count, rejected_count, reserved_amount)
       VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8) RETURNING id`,
      [cid(req), p.data.name ?? `RCS ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, p.data.from, JSON.stringify(p.data.content), rows.length, valid.length, rows.length - valid.length, total],
    );
    campaignId = ins.rows[0].id;
    for (const r of rows) await tx.query(`INSERT INTO rcs_campaign_recipients(campaign_id, destination, validation_status, reason) VALUES($1,$2,$3,$4)`, [campaignId, r.destination, r.state, r.reason]);
    const upd = await tx.query(`UPDATE rcs_wallets SET reserved=reserved+$1, updated_at=now() WHERE client_id=$2 RETURNING balance, reserved`, [total, cid(req)]);
    const rv = await tx.query(`INSERT INTO rcs_billing_reservations(client_id, campaign_id, amount) VALUES($1,$2,$3) RETURNING id`, [cid(req), campaignId, total]);
    await tx.query(`INSERT INTO rcs_ledger(client_id, reservation_id, campaign_id, type, amount, balance_after, reserved_after, event_key) VALUES($1,$2,$3,'reserve',$4,$5,$6,$7)`,
      [cid(req), rv.rows[0].id, campaignId, total, upd.rows[0].balance, upd.rows[0].reserved, `reserve-campaign:${campaignId}`]);
    await tx.query('COMMIT');
  } catch (e) { await tx.query('ROLLBACK').catch(() => undefined); const err = e as Error & { status?: number }; return void res.status(err.status ?? 500).json({ error: err.message }); } finally { tx.release(); }
  const { getRcsQueue, RCS_QUEUES: RQ2 } = await import('@8xtel/core');
  await getRcsQueue(RQ2.campaign).add('expand', { campaign_id: campaignId }, { jobId: campaignId }).catch(() => undefined);
  res.status(202).json({ campaign_id: campaignId, status: 'queued', summary: { total: rows.length, valid: valid.length, invalid: rows.filter((r) => r.state === 'invalid').length, duplicate: rows.filter((r) => r.state === 'duplicate').length }, reserved_amount: total });
});

router.get('/rcs/messages', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number((req.query as Record<string, string>).limit ?? 50)));
  const q = req.query as Record<string, string>;
  const params: unknown[] = [cid(req)]; const where = ['m.client_id=$1'];
  if (q.status) { params.push(q.status); where.push(`m.status=$${params.length}`); }
  if (q.destination) { params.push(`%${q.destination}%`); where.push(`m.destination LIKE $${params.length}`); }
  params.push(limit);
  const rows = await query(
    `SELECT m.id, m.sender, m.destination, m.content, m.status, m.price, m.submit_time, m.dlr_time, m.created_at, m.error_code
     FROM rcs_messages m WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT $${params.length}`, params,
  );
  res.json({ messages: rows });
});

router.get('/rcs/messages/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.status(404).json({ error: 'not found' }); return; }
  const row = await queryOne(`SELECT m.*, co.name AS country_name FROM rcs_messages m LEFT JOIN countries co ON co.id=m.country_id WHERE m.id=$1 AND m.client_id=$2`, [req.params.id, cid(req)]);
  if (!row) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ message: row });
});

router.get('/rcs/campaigns', async (req, res) => {
  const rows = await query(`SELECT c.*, (SELECT count(*) FROM rcs_messages m WHERE m.campaign_id=c.id AND m.status='delivered') AS delivered FROM rcs_campaigns c WHERE c.client_id=$1 ORDER BY c.created_at DESC LIMIT 100`, [cid(req)]);
  res.json({ campaigns: rows });
});

router.get('/rcs/campaigns/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.status(404).json({ error: 'not found' }); return; }
  const camp = await queryOne(`SELECT * FROM rcs_campaigns WHERE id=$1 AND client_id=$2`, [req.params.id, cid(req)]);
  if (!camp) { res.status(404).json({ error: 'not found' }); return; }
  const recips = await query(`SELECT destination, validation_status, reason, message_id FROM rcs_campaign_recipients WHERE campaign_id=$1 ORDER BY id LIMIT 2000`, [req.params.id]);
  const mix = await queryOne(`SELECT count(*) FILTER(WHERE status='delivered') AS delivered, count(*) FILTER(WHERE status IN ('failed','undelivered','expired','rejected')) AS failed, count(*) FILTER(WHERE status IN ('queued','accepted','submitted')) AS pending FROM rcs_messages WHERE campaign_id=$1`, [req.params.id]);
  res.json({ campaign: camp, recipients: recips, mix: mix ?? { delivered: '0', failed: '0', pending: '0' } });
});

router.get('/rcs/wallet', async (req, res) => {
  const w = await queryOne(`SELECT w.*, c.name AS client_name FROM rcs_wallets w JOIN clients c ON c.id=w.client_id WHERE w.client_id=$1`, [cid(req)]);
  const ledger = await query(`SELECT type, amount, balance_after, reserved_after, created_at FROM rcs_ledger WHERE client_id=$1 ORDER BY created_at DESC LIMIT 50`, [cid(req)]);
  res.json({ wallet: w ?? null, ledger });
});

router.get('/rcs/reports', async (req, res) => {
  const q = req.query as Record<string, string>;
  const day = q.day === 'yesterday' ? 'yesterday' : 'today';
  const filter = day === 'yesterday' ? `m.created_at >= CURRENT_DATE - interval '1 day' AND m.created_at < CURRENT_DATE` : `m.created_at >= CURRENT_DATE`;
  const rows = await query(`SELECT count(*) AS total, count(*) FILTER(WHERE status='delivered') AS delivered, count(*) FILTER(WHERE status IN ('failed','undelivered','expired','rejected')) AS failed, count(*) FILTER(WHERE status IN ('queued','accepted','submitted')) AS pending FROM rcs_messages m WHERE m.client_id=$1 AND ${filter}`, [cid(req)]);
  const byCountry = await query(`SELECT COALESCE(co.name,'Unknown') AS country, count(*) AS total, count(*) FILTER(WHERE m.status='delivered') AS delivered FROM rcs_messages m LEFT JOIN countries co ON co.id=m.country_id WHERE m.client_id=$1 AND ${filter} GROUP BY 1 ORDER BY total DESC LIMIT 20`, [cid(req)]);
  res.json({ day, totals: rows[0] ?? { total: '0', delivered: '0', failed: '0', pending: '0' }, by_country: byCountry });
});

router.get('/rcs/coverage', async (req, res) => {
  const rows = await query(
    `SELECT r.id, r.name, r.sender, co.name AS country_name, co.iso_code
     FROM rcs_routes r LEFT JOIN countries co ON co.id=r.country_id
     JOIN rcs_route_clients rc ON rc.route_id=r.id AND rc.client_id=$1
     WHERE r.status='active' ORDER BY co.name NULLS LAST, r.name`, [cid(req)],
  );
  const rates = await query(`SELECT co.name AS country_name, co.iso_code, rr.price FROM rcs_rates rr JOIN countries co ON co.id=rr.country_id WHERE rr.client_id=$1 ORDER BY rr.effective_from DESC`, [cid(req)]);
  const w = await queryOne<{ currency: string }>(`SELECT currency FROM rcs_wallets WHERE client_id=$1`, [cid(req)]);
  res.json({ currency: w?.currency ?? 'USD', routes: rows, rates });
});

export default router;
