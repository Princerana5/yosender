import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  query, queryOne, getPool, getQueue, QUEUES, tryAcquireTps, incrStat, submitQueueFor, getAnyQueue, trackBulkClient,
  type MessageJob,
} from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const EXPORT_MAX = 50000;
function csvEsc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells: unknown[]): string { return cells.map(csvEsc).join(','); }

function buildMessagesWhere(q: Record<string,string>, params: unknown[]): string[] {
  const where: string[] = [];
  const add = (sql: string, ...vals: unknown[]): void => {
    const slots = vals.map((v) => { params.push(v); return `$${params.length}`; });
    let i=0; where.push(sql.replace(/\?/g, () => slots[i++] ?? '?'));
  };
  if (q.client_id) add('m.client_id = ?', q.client_id);
  if (q.vendor_id) add('m.vendor_id = ?', q.vendor_id);
  if (q.country_id) add('m.country_id = ?', q.country_id);
  if (q.billing_mode) add('m.billing_mode = ?', q.billing_mode);
  if (q.billing_status) add('m.billing_status = ?', q.billing_status);
  if (q.destination) add('m.destination LIKE ?', `%${q.destination}%`);
  if (q.sender) add('m.source ILIKE ?', `%${q.sender}%`);
  if (q.message_id) add('(m.id::text = ? OR m.vendor_msg_id = ? OR m.client_msg_id = ?)', q.message_id, q.message_id, q.message_id);
  if (q.status) add('m.status = ?', q.status);
  if (q.route_id) add('m.route_id = ?', q.route_id);
  if (q.channel) add('m.channel = ?', q.channel);
  if (q.from) add('m.created_at >= ?', q.from);
  if (q.to) add('m.created_at <= ?', q.to);
  return where;
}

const MSG_EXPORT_COLS = ['ID','Client','Vendor','Blending Vendor','Source','Destination','Country','Status','Price','Cost','Billing Mode','Billed Status','Billed Amount','Error','Submitted','DLR Time','Cutting'] as const;
const DLR_EXPORT_COLS = ['Message ID','Vendor Msg ID','Destination','Source','Client','Vendor','Effective Vendor','Vendor Status','Client Status','Billing Mode','Billed Amount','DLR Time'] as const;

async function handleMessagesExport(req: import('express').Request, res: import('express').Response): Promise<void> {
  const q = req.query as Record<string,string>;
  const format = (q.format ?? 'csv').toLowerCase();
  if (!['csv','xlsx','excel'].includes(format)) { res.status(400).json({ error: 'format must be csv or xlsx' }); return; }
  const params: unknown[] = [];
  const where = buildMessagesWhere(q, params);
  const lim = Math.min(Number(q.limit ?? EXPORT_MAX), EXPORT_MAX);
  params.push(lim);
  const rows = await query<Record<string,unknown>>(
    `SELECT m.id, c.name AS client_name, v.name AS vendor_name, bv.name AS blending_vendor_name,
            m.source, m.destination, co.name AS country_name, m.status, m.client_price, m.vendor_cost,
            m.billing_mode, m.billing_status, m.billed_amount, m.error_description,
            m.submit_time, m.dlr_time, m.dlr_cutting_selected, q.queue_status AS cut_queue_status
     FROM messages m
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN vendors bv ON bv.id=m.blending_vendor_id
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN dlr_delay_queue q ON q.message_id=m.id
     ${where.length ? 'WHERE '+where.join(' AND ') : ''}
     ORDER BY m.created_at DESC LIMIT $${params.length}`,
    params,
  );
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  if (format === 'csv') {
    const header = csvRow([...MSG_EXPORT_COLS]);
    const lines = rows.map((r) => csvRow([
      r.id, r.client_name ?? '', r.vendor_name ?? '', r.blending_vendor_name ?? '',
      r.source ?? '', r.destination ?? '', r.country_name ?? '', r.status ?? '',
      r.client_price ?? '', r.vendor_cost ?? '', r.billing_mode ?? '', r.billing_status ?? '', r.billed_amount ?? '',
      (String(r.error_description ?? '').replace(/\s+/g,' ').slice(0,200)),
      r.submit_time ? new Date(String(r.submit_time)).toISOString() : '',
      r.dlr_time ? new Date(String(r.dlr_time)).toISOString() : '',
      r.dlr_cutting_selected ? String(r.cut_queue_status ?? 'selected') : 'direct',
    ]));
    const csv = [header, ...lines].join('\r\n');
    res.setHeader('content-type','text/csv; charset=utf-8');
    res.setHeader('content-disposition',`attachment; filename="message_logs_${stamp}.csv"`);
    res.send(csv);
    return;
  }
  const wb = new ExcelJS.Workbook(); wb.creator='8xtel'; wb.created=new Date();
  const ws = wb.addWorksheet('Message logs');
  const head = ws.addRow([...MSG_EXPORT_COLS]);
  head.font={ bold:true, color:{ argb:'FFFFFFFF' } }; head.fill={ type:'pattern', pattern:'solid', fgColor:{ argb:'FF0F172A' } };
  head.alignment={ vertical:'middle' }; ws.getRow(1).height=18;
  for (const r of rows) {
    ws.addRow([
      String(r.id ?? ''), String(r.client_name ?? ''), String(r.vendor_name ?? ''), String(r.blending_vendor_name ?? ''),
      String(r.source ?? ''), String(r.destination ?? ''), String(r.country_name ?? ''), String(r.status ?? ''),
      r.client_price!=null?Number(r.client_price):'', r.vendor_cost!=null?Number(r.vendor_cost):'',
      String(r.billing_mode ?? ''), String(r.billing_status ?? ''), r.billed_amount!=null?Number(r.billed_amount):'',
      String(r.error_description ?? '').slice(0,300),
      r.submit_time?new Date(String(r.submit_time)).toLocaleString():'',
      r.dlr_time?new Date(String(r.dlr_time)).toLocaleString():'',
      r.dlr_cutting_selected?String(r.cut_queue_status ?? 'selected'):'direct',
    ]);
  }
  ws.columns=[{width:38},{width:18},{width:16},{width:16},{width:12},{width:16},{width:14},{width:12},{width:10},{width:10},{width:18},{width:12},{width:12},{width:30},{width:20},{width:20},{width:12}];
  ws.views=[{ state:'frozen', ySplit:1 }];
  ws.autoFilter={ from:{ row:1, column:1 }, to:{ row:1, column: MSG_EXPORT_COLS.length } };
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition',`attachment; filename="message_logs_${stamp}.xlsx"`);
  res.send(Buffer.from(buf as unknown as Uint8Array));
}

async function handleDlrExport(req: import('express').Request, res: import('express').Response): Promise<void> {
  const q = req.query as Record<string,string>;
  const format = (q.format ?? 'csv').toLowerCase();
  if (!['csv','xlsx','excel'].includes(format)) { res.status(400).json({ error: 'format must be csv or xlsx' }); return; }
  const status = q.status ?? null;
  const from = q.from ?? null;
  const to = q.to ?? null;
  const lim = Math.min(Number(q.limit ?? EXPORT_MAX), EXPORT_MAX);
  const rows = await query<Record<string,unknown>>(
    `SELECT d.message_id, d.vendor_msg_id, m.destination, m.source, c.name AS client_name,
            v.name AS vendor_name, bv.name AS blending_vendor_name,
            COALESCE(bv.name, v.name) AS effective_vendor_name,
            d.vendor_status, d.client_status, m.billing_mode, m.billed_amount, d.created_at
     FROM dlrs d JOIN messages m ON m.id=d.message_id
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN vendors bv ON bv.id=m.blending_vendor_id
     WHERE ($1::text IS NULL OR d.client_status=$1)
       AND ($2::timestamptz IS NULL OR d.created_at >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR d.created_at <= $3::timestamptz)
     ORDER BY d.created_at DESC LIMIT $4`,
    [status, from, to, lim],
  );
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  if (format === 'csv') {
    const header = csvRow([...DLR_EXPORT_COLS]);
    const lines = rows.map((r) => csvRow([
      r.message_id, r.vendor_msg_id ?? '', r.destination ?? '', r.source ?? '', r.client_name ?? '',
      r.vendor_name ?? '', r.effective_vendor_name ?? '', r.vendor_status ?? '', r.client_status ?? '',
      r.billing_mode ?? '', r.billed_amount ?? '', r.created_at ? new Date(String(r.created_at)).toISOString() : '',
    ]));
    res.setHeader('content-type','text/csv; charset=utf-8');
    res.setHeader('content-disposition',`attachment; filename="dlr_logs_${stamp}.csv"`);
    res.send([header, ...lines].join('\r\n'));
    return;
  }
  const wb = new ExcelJS.Workbook(); wb.creator='8xtel'; wb.created=new Date();
  const ws = wb.addWorksheet('DLR logs');
  const head = ws.addRow([...DLR_EXPORT_COLS]);
  head.font={ bold:true, color:{ argb:'FFFFFFFF' } }; head.fill={ type:'pattern', pattern:'solid', fgColor:{ argb:'FF0F172A' } };
  head.alignment={ vertical:'middle' }; ws.getRow(1).height=18;
  for (const r of rows) {
    ws.addRow([
      String(r.message_id ?? ''), String(r.vendor_msg_id ?? ''), String(r.destination ?? ''), String(r.source ?? ''),
      String(r.client_name ?? ''), String(r.vendor_name ?? ''), String(r.effective_vendor_name ?? ''),
      String(r.vendor_status ?? ''), String(r.client_status ?? ''), String(r.billing_mode ?? ''),
      r.billed_amount!=null?Number(r.billed_amount):'', r.created_at?new Date(String(r.created_at)).toLocaleString():'',
    ]);
  }
  ws.columns=[{width:38},{width:22},{width:16},{width:12},{width:16},{width:16},{width:16},{width:14},{width:14},{width:14},{width:12},{width:20}];
  ws.views=[{ state:'frozen', ySplit:1 }];
  ws.autoFilter={ from:{ row:1, column:1 }, to:{ row:1, column: DLR_EXPORT_COLS.length } };
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition',`attachment; filename="dlr_logs_${stamp}.xlsx"`);
  res.send(Buffer.from(buf as unknown as Uint8Array));
}

const router = Router();
router.use(requirePerm('messages.read'));

// ── Searchable message log (§25). Content hidden unless ?include_text=1 ─────
router.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, ...vals: unknown[]): void => {
    const slots = vals.map((v) => {
      params.push(v);
      return `$${params.length}`;
    });
    let i = 0;
    where.push(sql.replace(/\?/g, () => slots[i++] ?? '?'));
  };
  if (q.client_id) add('m.client_id = ?', q.client_id);
  if (q.vendor_id) add('m.vendor_id = ?', q.vendor_id);
  if (q.country_id) add('m.country_id = ?', q.country_id);
  if (q.billing_mode) add('m.billing_mode = ?', q.billing_mode);
  if (q.billing_status) add('m.billing_status = ?', q.billing_status);
  if (q.destination) add('m.destination LIKE ?', `%${q.destination}%`);
  if (q.sender) add('m.source ILIKE ?', `%${q.sender}%`);
  if (q.message_id) {
    add(
      '(m.id::text = ? OR m.vendor_msg_id = ? OR m.client_msg_id = ?)',
      q.message_id, q.message_id, q.message_id,
    );
  }
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
            m.blending_vendor_id, bv.name AS blending_vendor_name,
            m.route_id, m.channel, m.client_msg_id, m.vendor_msg_id, m.source, m.destination,
            co.name AS country_name, co.iso_code, m.status, m.client_price, m.vendor_cost,
            m.billing_mode, m.billing_status, m.billed_amount, m.error_description,
            m.submit_time, m.dlr_time, m.error_code, m.attempts, m.created_at,
            m.dlr_cutting_selected, m.dlr_cutting_delay_seconds, m.dlr_cutting_config_id,
            q.queue_status AS cut_queue_status, q.delay_seconds AS cut_delay_seconds,
            q.received_at AS cut_received_at, q.release_at AS cut_release_at, q.released_at AS cut_released_at, q.original_status AS cut_original_status
     FROM messages m
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN vendors bv ON bv.id=m.blending_vendor_id
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN dlr_delay_queue q ON q.message_id=m.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY m.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ messages: rows, limit, offset });
});

// ── Exports for NOC: filtered CSV/XLSX download (same filters as GET /) ─────
router.get('/export', handleMessagesExport);
router.get('/dlr/export', handleDlrExport);
router.get('/dlr/logs/export', handleDlrExport);

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
  if (!(await tryAcquireTps(`client:${client.id}`, client.tps_limit))) {
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
  const job = {
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
    _bulk: false,
  } as MessageJob & { _bulk: boolean };
  await getAnyQueue(submitQueueFor(job)).add('submit', job as never, { jobId: internalId });
  await incrStat('submitted');

  res.status(202).json({ id: internalId, client_msg_id: clientMsgId, status: 'submitted' });
});

// ── DLR log (§16) ───────────────────────────────────────────────────────────
router.get('/dlr/logs', async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await query(
    `SELECT d.*, m.destination, m.source, c.name AS client_name,
            v.name AS vendor_name, bv.name AS blending_vendor_name,
            m.billing_mode, m.billing_status, m.billed_amount,
            COALESCE(m.blending_vendor_id, m.vendor_id) AS effective_vendor_id,
            COALESCE(bv.name, v.name) AS effective_vendor_name
     FROM dlrs d JOIN messages m ON m.id=d.message_id
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN vendors bv ON bv.id=m.blending_vendor_id
     WHERE ($1::text IS NULL OR d.client_status=$1)
       AND ($2::timestamptz IS NULL OR d.created_at >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR d.created_at <= $3::timestamptz)
     ORDER BY d.created_at DESC LIMIT 200`,
    [q.status ?? null, q.from ?? null, q.to ?? null],
  );
  res.json({ dlrs: rows });
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
    `SELECT d.*, m.destination, m.source, c.name AS client_name,
            v.name AS vendor_name, bv.name AS blending_vendor_name,
            m.billing_mode, m.billing_status, m.billed_amount,
            COALESCE(m.blending_vendor_id, m.vendor_id) AS effective_vendor_id,
            COALESCE(bv.name, v.name) AS effective_vendor_name
     FROM dlrs d JOIN messages m ON m.id=d.message_id
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN vendors bv ON bv.id=m.blending_vendor_id
     WHERE ($1::text IS NULL OR d.client_status=$1)
     ORDER BY d.created_at DESC LIMIT 200`,
    [q.status ?? null],
  );
  res.json({ dlrs: rows });
});

export default router;
