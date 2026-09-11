import { Router } from 'express';
import { query } from '@8xtel/core';
import { requirePerm } from '../middleware.js';

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

router.get('/:id', async (req, res) => {
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
