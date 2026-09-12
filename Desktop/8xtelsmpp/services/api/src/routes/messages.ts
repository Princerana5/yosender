import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  query, queryOne, getPool, getQueue, QUEUES, checkTps, incrStat,
  type MessageJob,
} from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('messages.read'));

// ── Searchable message log (§25). Content hidden unless ?include_text=1 ─────
router.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown): void => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (q.client_id) add('m.client_id = ?', q.client_id);
  if (q.vendor_id) add('m.vendor_id = ?', q.vendor_id);
  if (q.country_id) add('m.country_id = ?', q.country_id);
  if (q.destination) add('m.destination LIKE ?', `%${q.destination}%`);
  if (q.sender) add('m.source ILIKE ?', `%${q.sender}%`);
  if (q.message_id) add('(m.id::text = ? OR m.vendor_msg_id = ? OR m.client_msg_id = ?)', q.message_id);
  if (q.status) add('m.status = ?', q.status);
  if (q.route_id) add('m.route_id = ?', q.route_id);
  if (q.channel) add('m.channel = ?', q.channel);
  if (q.from) add('m.created_at >= ?', q.from);
  if (q.to) add('m.created_at <= ?', q.to);

  const limit = Math.min(Number(q.limit ?? 50), 500);
  const offset = Number(q.offset ?? 0);
  params.push(limit, offset);
  const textCol = q.include_text === '1' ? 'm.text,' : '';

  const rows = await query(
    `SELECT m.id, ${textCol} m.client_id, c.name AS client_name, m.vendor_id, v.name AS vendor_name,
            m.route_id, m.channel, m.client_msg_id, m.vendor_msg_id, m.source, m.destination,
            co.name AS country_name, co.iso_code, m.status, m.client_price, m.vendor_cost,
            m.submit_time, m.dlr_time, m.error_code, m.attempts, m.created_at
     FROM messages m
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN countries co ON co.id=m.country_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY m.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ messages: rows, limit, offset });
});

router.get('/failed', async (req, res) => {
  const rows = await query(
    `SELECT m.*, c.name AS client_name, v.name AS vendor_name FROM messages m
     LEFT JOIN clients c ON c.id=m.client_id LEFT JOIN vendors v ON v.id=m.vendor_id
     WHERE m.status IN ('failed','undelivered','expired','rejected')
     ORDER BY m.created_at DESC LIMIT 200`,
  );
  res.json({ messages: rows });
});

// ── Send test SMS (§15): admin injects a message as a client ─────────────────
// Same pipeline as an SMPP submit_sm: persist → sms:submit queue → routing →
// vendor → DLR → billing. Guards mirror smpp-server/session.ts (active
// account, balance, TPS, blocked sender). Permission: messages.send.
const sendSchema = z.object({
  client_id: z.string().uuid(),
  source: z.string().min(1).max(21),
  destination: z.string().min(4).max(20).regex(/^[+\d][\d\s-]*$/),
  text: z.string().min(1).max(2000),
  // Test overrides: force a route and/or a single vendor (skip route matching).
  // At least the client stays mandatory — it owns billing, TPS and sender rules.
  route_id: z.string().uuid().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
});

router.post('/send', requirePerm('messages.send'), audit('sent_test_sms', 'message'), async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const { client_id, source, destination, text, route_id, vendor_id } = parsed.data;

  const client = await queryOne<{
    id: string; name: string; status: string; balance: string; credit_limit: string; tps_limit: number;
  }>('SELECT id, name, status, balance, credit_limit, tps_limit FROM clients WHERE id=$1', [client_id]);
  if (!client) {
    res.status(404).json({ error: 'client not found' });
    return;
  }
  if (client.status !== 'active') {
    res.status(422).json({ error: `client account is ${client.status}` });
    return;
  }
  if (Number(client.balance) + Number(client.credit_limit) <= 0) {
    res.status(422).json({ error: 'insufficient balance' });
    return;
  }
  if (!(await checkTps(`client:${client.id}`, client.tps_limit))) {
    res.status(429).json({ error: 'client TPS limit exceeded — try again in a second' });
    return;
  }
  const senderRule = await queryOne<{ status: string }>(
    `SELECT status FROM sender_ids WHERE client_id=$1 AND sender=$2
     ORDER BY country_id NULLS LAST LIMIT 1`,
    [client.id, source],
  );
  if (senderRule && senderRule.status === 'blocked') {
    res.status(422).json({ error: `sender id "${source}" is blocked for this client` });
    return;
  }
  if (route_id) {
    const r = await queryOne<{ id: string; name: string }>('SELECT id, name FROM routes WHERE id=$1', [route_id]);
    if (!r) {
      res.status(404).json({ error: 'route not found' });
      return;
    }
  }
  if (vendor_id) {
    const v = await queryOne<{ id: string; name: string; status: string }>(
      'SELECT id, name, status FROM vendors WHERE id=$1', [vendor_id],
    );
    if (!v) {
      res.status(404).json({ error: 'vendor not found' });
      return;
    }
    if (v.status !== 'enabled') {
      res.status(422).json({ error: `vendor "${v.name}" is ${v.status}` });
      return;
    }
  }

  const internalId = randomUUID();
  const clientMsgId = `ui-${internalId.slice(0, 8)}`;
  await getPool().query(
    `INSERT INTO messages (id, client_id, channel, client_msg_id, source, destination, text, data_coding, status)
     VALUES ($1,$2,'sms',$3,$4,$5,$6,0,'submitted')`,
    [internalId, client.id, clientMsgId, source, destination, text],
  );
  const job: MessageJob = {
    internal_id: internalId,
    client_id: client.id,
    client_msg_id: clientMsgId,
    channel: 'sms',
    source,
    destination,
    country_id: null,
    text,
    data_coding: 0,
    route_id: null,
    attempts: 0,
    force_route_id: route_id ?? null,
    force_vendor_id: vendor_id ?? null,
  };
  await getQueue(QUEUES.submit).add('submit', job, { jobId: internalId });
  await incrStat('submitted');

  res.status(202).json({ id: internalId, client_msg_id: clientMsgId, status: 'submitted' });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id', async (req, res) => {
  // Non-UUID ids used to throw an unhandled pg error and crash the process
  if (!UUID_RE.test(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const rows = await query('SELECT * FROM messages WHERE id=$1', [req.params.id]);
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const events = await query('SELECT * FROM message_events WHERE message_id=$1 ORDER BY created_at', [req.params.id]);
  const dlr = await query('SELECT * FROM dlrs WHERE message_id=$1', [req.params.id]);
  res.json({ message: rows[0], events, dlr: dlr[0] ?? null });
});

// ── DLR log (§16) ───────────────────────────────────────────────────────────
router.get('/dlr/logs', async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await query(
    `SELECT d.*, m.destination, m.source, c.name AS client_name, v.name AS vendor_name
     FROM dlrs d JOIN messages m ON m.id=d.message_id
     LEFT JOIN clients c ON c.id=m.client_id LEFT JOIN vendors v ON v.id=m.vendor_id
     WHERE ($1::text IS NULL OR d.client_status=$1)
     ORDER BY d.created_at DESC LIMIT 200`,
    [q.status ?? null],
  );
  res.json({ dlrs: rows });
});

export default router;
