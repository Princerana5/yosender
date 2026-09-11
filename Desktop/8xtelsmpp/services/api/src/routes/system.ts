import { Router } from 'express';
import { query, getPool, getRedis } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { hashPassword } from '../auth.js';

const router = Router();

// ── Health (§38) ────────────────────────────────────────────────────────────
router.get('/health', async (_req, res) => {
  res.json({ status: 'ok', service: '8xtelSMPP-api', time: new Date().toISOString() });
});

router.get('/health/database', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'error', detail: (e as Error).message });
  }
});

router.get('/health/redis', async (_req, res) => {
  try {
    const pong = await getRedis().ping();
    res.json({ status: pong === 'PONG' ? 'ok' : 'degraded' });
  } catch (e) {
    res.status(503).json({ status: 'error', detail: (e as Error).message });
  }
});

router.get('/health/smpp', requirePerm('system.logs'), async (_req, res) => {
  const conns = await query(
    `SELECT vc.*, v.name AS vendor_name FROM vendor_connections vc JOIN vendors v ON v.id=vc.vendor_id ORDER BY v.name, vc.conn_index`,
  );
  res.json({ connections: conns });
});

// ── SMPP connection control (§9) — signals vendor-worker via Redis ──────────
router.post('/connections/:id/:action', requirePerm('vendors.reconnect'), audit('smpp_connection_action', 'vendor_connection'), async (req, res) => {
  const { id, action } = req.params;
  if (!['connect', 'disconnect', 'reconnect', 'restart'].includes(action)) {
    res.status(400).json({ error: 'unknown action' });
    return;
  }
  await getRedis().publish('smpp:control', JSON.stringify({ connection_id: id, action, at: Date.now() }));
  res.json({ ok: true, action, connection_id: id });
});

// ── Logs (§27, §31) ─────────────────────────────────────────────────────────
router.get('/smpp-logs', requirePerm('system.logs'), async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await query(
    `SELECT * FROM smpp_logs WHERE ($1::text IS NULL OR kind=$1) ORDER BY created_at DESC LIMIT 200`,
    [q.kind ?? null],
  );
  res.json({ logs: rows });
});

router.get('/audit-logs', requirePerm('system.logs'), async (_req, res) => {
  const rows = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
  res.json({ logs: rows });
});

// ── Countries (§22) ─────────────────────────────────────────────────────────
router.get('/countries', async (_req, res) => {
  res.json({ countries: await query('SELECT * FROM countries ORDER BY name') });
});

router.patch('/countries/:id', requirePerm('system.settings'), audit('updated_country', 'country'), async (req, res) => {
  const rows = await query('UPDATE countries SET status=$1 WHERE id=$2 RETURNING *', [
    req.body.status === 'disabled' ? 'disabled' : 'active', req.params.id,
  ]);
  res.json({ country: rows[0] ?? null });
});

// ── Sender IDs (§21) ────────────────────────────────────────────────────────
router.get('/senders', async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await query(
    'SELECT * FROM sender_ids WHERE ($1::uuid IS NULL OR client_id=$1::uuid) ORDER BY sender',
    [q.client_id ?? null],
  );
  res.json({ senders: rows });
});

router.post('/senders', requirePerm('clients.update'), audit('managed_sender', 'sender_id'), async (req, res) => {
  const { client_id, sender, country_id, status } = req.body as Record<string, string>;
  const rows = await query(
    `INSERT INTO sender_ids (client_id, sender, country_id, status) VALUES ($1,$2,$3,$4)
     ON CONFLICT (client_id, sender, country_id) DO UPDATE SET status=EXCLUDED.status RETURNING *`,
    [client_id, sender, country_id ?? null, status ?? 'approved'],
  );
  res.status(201).json({ sender: rows[0] });
});

// ── Users (§30) ─────────────────────────────────────────────────────────────
router.get('/users', requirePerm('users.manage'), async (_req, res) => {
  const rows = await query(
    'SELECT u.id, u.email, u.full_name, r.name AS role, u.is_active, u.last_login_at, u.created_at FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at',
  );
  res.json({ users: rows });
});

router.post('/users', requirePerm('users.manage'), audit('created_user', 'user'), async (req, res) => {
  const { email, password, full_name, role } = req.body as Record<string, string>;
  const r = await query('SELECT id FROM roles WHERE name=$1', [role ?? 'read_only']);
  if (!r.length) {
    res.status(400).json({ error: 'unknown role' });
    return;
  }
  const rows = await query(
    'INSERT INTO users (email, password_hash, full_name, role_id) VALUES ($1,$2,$3,$4) RETURNING id, email, full_name',
    [String(email).toLowerCase(), await hashPassword(String(password)), full_name ?? null, (r[0] as { id: string }).id],
  );
  res.status(201).json({ user: rows[0] });
});

export default router;
