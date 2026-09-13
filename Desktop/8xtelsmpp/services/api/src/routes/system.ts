import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, queryOne, getPool, getRedis } from '@8xtel/core';
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
    `SELECT vc.*, v.name AS vendor_name, v.host, v.port, v.system_id, v.bind_type, v.status AS vendor_status
     FROM vendor_connections vc JOIN vendors v ON v.id=vc.vendor_id ORDER BY v.name, vc.conn_index`,
  );
  // Attach the latest log line per connection so the UI can show WHY this
  // state happened (bind reject, auth failure, socket error…) + a copyable reason.
  const withReason = await Promise.all(conns.map(async (c) => {
    const row = c as Record<string, unknown>;
    const log = await queryOne<{ kind: string; result: string | null; reason: string | null; created_at: string }>(
      `SELECT kind, result, reason, created_at FROM smpp_logs
       WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [row.vendor_id],
    );
    const status = String(row.status ?? 'disconnected');
    const reason = (row.last_error as string | null)
      ?? log?.reason ?? log?.result ?? null;
    return {
      ...row,
      bind_type: row.bind_type ?? 'transceiver',
      last_log_kind: log?.kind ?? null,
      last_log_at: log?.created_at ?? null,
      // Human + copyable one-liner: "VendorA #0 — RECONNECTING (bind failed status=13)"
      status_line: `${row.vendor_name ?? 'vendor'} #${row.conn_index ?? 0} — ${status.toUpperCase()}${reason ? ` (${reason})` : ''}`,
    };
  }));
  res.json({ connections: withReason });
});

// ── Per-connection log trail: why did THIS bind get here? ───────────────────
router.get('/connections/:id/logs', requirePerm('system.logs'), async (req, res) => {
  const conn = await queryOne<{ vendor_id: string; conn_index: number }>(
    'SELECT vendor_id, conn_index FROM vendor_connections WHERE id=$1', [req.params.id],
  );
  if (!conn) {
    res.status(404).json({ error: 'connection not found' });
    return;
  }
  const q = req.query as Record<string, string>;
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const rows = await query(
    `SELECT id, kind, ip, port, system_id, result, reason, created_at FROM smpp_logs
     WHERE vendor_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [conn.vendor_id, limit],
  );
  res.json({ connection_id: req.params.id, vendor_id: conn.vendor_id, conn_index: conn.conn_index, logs: rows });
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

// ── Sender-ID requests: approve (= sender_ids row) or reject ────────────────
router.get('/sender-requests', requirePerm('clients.update'), async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await query(
    `SELECT sr.*, c.name AS client_name, co.name AS country_name FROM sender_requests sr
     JOIN clients c ON c.id=sr.client_id LEFT JOIN countries co ON co.id=sr.country_id
     WHERE ($1::text IS NULL OR sr.status=$1)
     ORDER BY sr.created_at DESC LIMIT 200`,
    [q.status ?? null],
  );
  res.json({ requests: rows });
});

router.post('/sender-requests/:id/review', requirePerm('clients.update'), audit('reviewed_sender_request', 'sender_request'), async (req, res) => {
  const parsed = z.object({
    action: z.enum(['approve', 'reject']),
    remark: z.string().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const rows = await query('SELECT * FROM sender_requests WHERE id=$1', [req.params.id]);
  const sr = rows[0] as { id: string; client_id: string; sender: string; country_id: string | null; status: string } | undefined;
  if (!sr) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (sr.status !== 'pending') {
    res.status(409).json({ error: `already ${sr.status}` });
    return;
  }
  if (parsed.data.action === 'approve') {
    await query(
      `INSERT INTO sender_ids (client_id, sender, country_id, status) VALUES ($1,$2,$3,'approved')
       ON CONFLICT (client_id, sender, country_id) DO UPDATE SET status='approved'`,
      [sr.client_id, sr.sender, sr.country_id],
    );
  }
  await query(
    `UPDATE sender_requests SET status=$1, reviewed_by=$2, reviewer_remark=$3, reviewed_at=now() WHERE id=$4`,
    [parsed.data.action === 'approve' ? 'approved' : 'rejected', (req.user as { id: string }).id, parsed.data.remark ?? null, sr.id],
  );
  res.json({ ok: true, action: parsed.data.action });
});

// ── Users & roles (§30) ──────────────────────────────────────────────────────
// Any email can be invited and assigned any role. Password is auto-generated
// when omitted and returned ONCE (stored as bcrypt hash).
router.get('/users', requirePerm('users.manage'), async (_req, res) => {
  const rows = await query(
    'SELECT u.id, u.email, u.full_name, r.name AS role, u.is_active, u.last_login_at, u.created_at FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at',
  );
  res.json({ users: rows });
});

router.get('/roles', requirePerm('users.manage'), async (_req, res) => {
  const rows = await query('SELECT id, name, description FROM roles ORDER BY name');
  res.json({ roles: rows });
});

router.post('/users', requirePerm('users.manage'), audit('created_user', 'user'), async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(8).optional(), // auto-generated if omitted
    full_name: z.string().max(200).optional(),
    role: z.string().default('read_only'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const r = await query('SELECT id FROM roles WHERE name=$1', [parsed.data.role]);
  if (!r.length) {
    res.status(400).json({ error: 'unknown role' });
    return;
  }
  const plain = parsed.data.password ?? crypto.randomBytes(12).toString('base64url');
  try {
    const rows = await query(
      'INSERT INTO users (email, password_hash, full_name, role_id) VALUES ($1,$2,$3,$4) RETURNING id, email, full_name',
      [parsed.data.email.toLowerCase(), await hashPassword(plain), parsed.data.full_name ?? null, (r[0] as { id: string }).id],
    );
    res.status(201).json({
      user: { ...(rows[0] as object), role: parsed.data.role },
      password: plain, // shown ONCE
      password_mode: req.body?.password ? 'manual' : 'generated',
    });
  } catch (e) {
    const msg = (e as { code?: string }).code === '23505' ? 'email already in use' : 'create failed';
    res.status(409).json({ error: msg });
  }
});

router.patch('/users/:id', requirePerm('users.manage'), audit('updated_user', 'user'), async (req, res) => {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (req.body?.full_name !== undefined) {
    params.push(req.body.full_name || null);
    sets.push(`full_name = $${params.length}`);
  }
  if (req.body?.is_active !== undefined) {
    params.push(!!req.body.is_active);
    sets.push(`is_active = $${params.length}`);
  }
  if (req.body?.role !== undefined) {
    const r = await query('SELECT id FROM roles WHERE name=$1', [String(req.body.role)]);
    if (!r.length) {
      res.status(400).json({ error: 'unknown role' });
      return;
    }
    params.push((r[0] as { id: string }).id);
    sets.push(`role_id = $${params.length}`);
  }
  if (!sets.length) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  // Never let the last active super_admin lock themselves out
  if (req.body?.is_active === false || req.body?.role !== undefined) {
    const target = await queryOne<{ role: string; is_active: boolean }>(
      'SELECT r.name AS role, u.is_active FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1',
      [req.params.id],
    );
    if (target?.role === 'super_admin') {
      const others = await query(
        `SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
         WHERE r.name='super_admin' AND u.is_active AND u.id<>$1 LIMIT 1`,
        [req.params.id],
      );
      if (!others.length) {
        res.status(422).json({ error: 'cannot demote or disable the last active super_admin' });
        return;
      }
    }
  }
  params.push(req.params.id);
  const rows = await query(
    `UPDATE users SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}
     RETURNING u.id, u.email, u.full_name, u.is_active`,
    params,
  );
  // re-join role name (UPDATE … RETURNING can't join)
  const full = await queryOne(
    'SELECT u.id, u.email, u.full_name, r.name AS role, u.is_active FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1',
    [req.params.id],
  );
  if (!rows.length || !full) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ user: full });
});

router.post('/users/:id/reset-password', requirePerm('users.manage'), audit('reset_user_password', 'user'), async (req, res) => {
  const row = await queryOne<{ email: string }>('SELECT email FROM users WHERE id=$1', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const plain = typeof req.body?.password === 'string' && req.body.password.length >= 8
    ? String(req.body.password)
    : crypto.randomBytes(12).toString('base64url');
  await query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [
    await hashPassword(plain),
    req.params.id,
  ]);
  res.json({ email: row.email, password: plain }); // shown ONCE
});

router.delete('/users/:id', requirePerm('users.manage'), audit('deleted_user', 'user'), async (req, res) => {
  const target = await queryOne<{ role: string }>(
    'SELECT r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1',
    [req.params.id],
  );
  if (!target) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if ((req.user as { id?: string })?.id === req.params.id) {
    res.status(422).json({ error: 'cannot delete your own account' });
    return;
  }
  if (target.role === 'super_admin') {
    const others = await query(
      `SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id
       WHERE r.name='super_admin' AND u.is_active AND u.id<>$1 LIMIT 1`,
      [req.params.id],
    );
    if (!others.length) {
      res.status(422).json({ error: 'cannot delete the last active super_admin' });
      return;
    }
  }
  await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
