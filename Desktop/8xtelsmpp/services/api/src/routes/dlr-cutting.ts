import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('routes.read'));

// ── Schemas ─────────────────────────────────────────────────────────────────
const scopeEnum = z.enum(['global', 'route', 'client', 'country']);
const statusEnum = z.enum(['active', 'disabled']);

const upsertSchema = z.object({
  enabled: z.boolean().default(false),
  percentage: z.number().min(0).max(100),
  interval_messages: z.number().int().positive(),
  delay_seconds: z.number().int().min(0).max(86400),
  selection_mode: z.enum(['random', 'sequential']).default('random'),
  scope: scopeEnum,
  status: statusEnum.default('active'),
  client_id: z.string().uuid().nullable().optional(),
  route_id: z.string().uuid().nullable().optional(),
  country_id: z.string().uuid().nullable().optional(),
});

function validateScope(body: z.infer<typeof upsertSchema>): string | null {
  if (body.scope === 'global' && (body.client_id || body.route_id || body.country_id)) return 'global scope must not have client_id/route_id/country_id';
  if (body.scope === 'route' && !body.route_id) return 'route scope requires route_id';
  if (body.scope === 'client' && !body.client_id) return 'client scope requires client_id';
  if (body.scope === 'country' && !body.country_id) return 'country scope requires country_id';
  return null;
}

// ── List all configs (admin table) ──────────────────────────────────────────
router.get('/configs', async (_req, res) => {
  const rows = await query(
    `SELECT dcc.*, r.name AS route_name, c.name AS client_name, co.name AS country_name,
            COALESCE(s.messages_processed,0) AS messages_processed,
            COALESCE(s.messages_selected,0) AS messages_selected,
            COALESCE(s.dlrs_received,0) AS dlrs_received,
            COALESCE(s.dlrs_delayed,0) AS dlrs_delayed,
            COALESCE(s.dlrs_released,0) AS dlrs_released,
            COALESCE(s.currently_queued,0) AS currently_queued,
            s.avg_delay_ms, COALESCE(s.failed_jobs,0) AS failed_jobs,
            cc.processed AS counter_processed, cc.selected AS counter_selected
     FROM dlr_cutting_configs dcc
     LEFT JOIN routes r ON r.id=dcc.route_id
     LEFT JOIN clients c ON c.id=dcc.client_id
     LEFT JOIN countries co ON co.id=dcc.country_id
     LEFT JOIN dlr_cutting_stats s ON s.config_id=dcc.id
     LEFT JOIN dlr_cutting_counters cc ON cc.config_id=dcc.id
     ORDER BY dcc.created_at DESC`,
  );
  // Also compute live queue depth per config from the queue table (authoritative)
  const queuedByConfig = await query<{ config_id: string; n: string }>(
    `SELECT dlr_cutting_config_id AS config_id, COUNT(*) AS n FROM messages
     WHERE dlr_cutting_selected=true AND dlr_cutting_config_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM dlr_delay_queue q WHERE q.message_id=messages.id AND q.queue_status='queued')
     GROUP BY 1`,
  ).catch(() => []);
  void queuedByConfig;
  res.json({ configs: rows });
});

// ── Resolve active config for a context (used by UI "effective config" badge) ──
router.get('/resolve', async (req, res) => {
  const q = req.query as Record<string, string>;
  const route_id = q.route_id ?? null;
  const client_id = q.client_id ?? null;
  const country_id = q.country_id ?? null;
  const { resolveCuttingConfig } = await import('@8xtel/core');
  const cfg = await resolveCuttingConfig({ route_id, client_id, country_id });
  res.json({ config: cfg });
});

// ── Get single config + live stats ───────────────────────────────────────────
router.get('/configs/:id', async (req, res) => {
  const row = await queryOne(
    `SELECT dcc.*, r.name AS route_name, c.name AS client_name, co.name AS country_name
     FROM dlr_cutting_configs dcc
     LEFT JOIN routes r ON r.id=dcc.route_id
     LEFT JOIN clients c ON c.id=dcc.client_id
     LEFT JOIN countries co ON co.id=dcc.country_id
     WHERE dcc.id=$1`, [req.params.id],
  );
  if (!row) { res.status(404).json({ error: 'config not found' }); return; }
  const stats = await queryOne(
    `SELECT * FROM dlr_cutting_stats WHERE config_id=$1`, [req.params.id],
  );
  const counter = await queryOne(
    `SELECT * FROM dlr_cutting_counters WHERE config_id=$1`, [req.params.id],
  );
  const interval = Number((row as { interval_messages: string }).interval_messages ?? 100);
  const processed = Number((counter as { processed?: string } | null)?.processed ?? (stats as { messages_processed?: string } | null)?.messages_processed ?? 0);
  const pos = interval ? processed % interval : 0;
  res.json({
    config: row,
    stats: stats ?? null,
    counter: counter ?? null,
    interval_remaining: interval ? interval - pos : null,
    interval_position: pos,
  });
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post('/configs', requirePerm('routes.create'), audit('created_dlr_cutting_config', 'dlr_cutting_config'), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  const b = parsed.data;
  const err = validateScope(b);
  if (err) { res.status(400).json({ error: err }); return; }
  try {
    const { rows } = await getPool().query(
      `INSERT INTO dlr_cutting_configs (enabled, percentage, interval_messages, delay_seconds, selection_mode, scope, status, client_id, route_id, country_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.enabled, b.percentage, b.interval_messages, b.delay_seconds, b.selection_mode, b.scope, b.status, b.client_id ?? null, b.route_id ?? null, b.country_id ?? null],
    );
    res.status(201).json({ config: rows[0] });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = (e as Error).message ?? '';
    if (code === '23505' || msg.includes('duplicate')) {
      res.status(409).json({ error: 'a config already exists for this (scope, client, route, country) tuple — edit it instead' });
      return;
    }
    throw e;
  }
});

// ── Update ───────────────────────────────────────────────────────────────────
router.patch('/configs/:id', requirePerm('routes.update'), audit('updated_dlr_cutting_config', 'dlr_cutting_config'), async (req, res) => {
  const cur = await queryOne<Record<string, unknown>>('SELECT * FROM dlr_cutting_configs WHERE id=$1', [req.params.id]);
  if (!cur) { res.status(404).json({ error: 'config not found' }); return; }
  const allowed = ['enabled', 'percentage', 'interval_messages', 'delay_seconds', 'selection_mode', 'scope', 'status', 'client_id', 'route_id', 'country_id'] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) {
      params.push(req.body[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (!sets.length) { res.status(400).json({ error: 'nothing to update' }); return; }
  // Validate resulting scope coherence
  const next = { ...(cur as Record<string, unknown>), ...(req.body as Record<string, unknown>) } as unknown as z.infer<typeof upsertSchema>;
  const v = validateScope(next);
  if (v) { res.status(400).json({ error: v }); return; }
  if (next.percentage !== undefined && (Number(next.percentage) < 0 || Number(next.percentage) > 100)) {
    res.status(400).json({ error: 'percentage must be 0-100' }); return;
  }
  if (next.interval_messages !== undefined && Number(next.interval_messages) <= 0) {
    res.status(400).json({ error: 'interval_messages must be > 0' }); return;
  }
  params.push(req.params.id);
  try {
    const { rows } = await getPool().query(
      `UPDATE dlr_cutting_configs SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params,
    );
    res.json({ config: rows[0] });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') { res.status(409).json({ error: 'duplicate (scope, client, route, country) tuple' }); return; }
    throw e;
  }
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/configs/:id', requirePerm('routes.delete'), audit('deleted_dlr_cutting_config', 'dlr_cutting_config'), async (req, res) => {
  const r = await getPool().query('DELETE FROM dlr_cutting_configs WHERE id=$1', [req.params.id]);
  if (!r.rowCount) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ ok: true });
});

// ── Live stats (aggregated) ──────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  const agg = await queryOne<{
    messages_processed: string; messages_selected: string;
    dlrs_received: string; dlrs_delayed: string; dlrs_released: string;
    currently_queued: string; failed_jobs: string;
  }>(
    `SELECT COALESCE(SUM(messages_processed),0) AS messages_processed,
            COALESCE(SUM(messages_selected),0) AS messages_selected,
            COALESCE(SUM(dlrs_received),0) AS dlrs_received,
            COALESCE(SUM(dlrs_delayed),0) AS dlrs_delayed,
            COALESCE(SUM(dlrs_released),0) AS dlrs_released,
            COALESCE(SUM(currently_queued),0) AS currently_queued,
            COALESCE(SUM(failed_jobs),0) AS failed_jobs
     FROM dlr_cutting_stats`,
  );
  // Authoritative queued count from the queue table (in case stats lag)
  const [qCount] = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM dlr_delay_queue WHERE queue_status='queued'`,
  ).catch(() => [{ n: '0' }]);
  res.json({
    stats: agg ? {
      messages_processed: Number(agg.messages_processed),
      messages_selected: Number(agg.messages_selected),
      selection_pct: Number(agg.messages_processed) ? +(Number(agg.messages_selected) / Number(agg.messages_processed) * 100).toFixed(2) : 0,
      dlrs_received: Number(agg.dlrs_received),
      dlrs_delayed: Number(agg.dlrs_delayed),
      dlrs_released: Number(agg.dlrs_released),
      currently_queued: Number(qCount.n),
      failed_jobs: Number(agg.failed_jobs),
    } : null,
  });
});

// ── Delayed DLR logs ─────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, ...vals: unknown[]): void => {
    const slots = vals.map((v) => { params.push(v); return `$${params.length}`; });
    let i = 0;
    where.push(sql.replace(/\?/g, () => slots[i++] ?? '?'));
  };
  if (q.client_id) add('q.client_id = ?', q.client_id);
  if (q.route_id) add('q.route_id = ?', q.route_id);
  if (q.vendor_id) add('q.vendor_id = ?', q.vendor_id);
  if (q.country_id) add('q.country_id = ?', q.country_id);
  if (q.queue_status) add('q.queue_status = ?', q.queue_status);
  if (q.original_status) add('q.original_status = ?', q.original_status);
  if (q.selected !== undefined && q.selected !== '') add('q.selected = ?', q.selected === 'true');
  if (q.from) add('q.created_at >= ?', q.from);
  if (q.to) add('q.created_at <= ?', q.to);
  if (q.message_id) add('(q.message_id::text = ? OR q.dlr_id::text = ?)', q.message_id, q.message_id);
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const offset = Math.max(0, Number(q.offset ?? 0));
  params.push(limit, offset);
  const rows = await query(
    `SELECT q.*, c.name AS client_name, r.name AS route_name, v.name AS vendor_name, co.name AS country_name,
            bv.name AS blending_vendor_name, COALESCE(q.blending_vendor_id, q.vendor_id) AS effective_vendor_id,
            COALESCE(bv.name, v.name) AS effective_vendor_name,
            m.destination, m.source, m.dlr_cutting_config_id
     FROM dlr_delay_queue q
     LEFT JOIN clients c ON c.id=q.client_id
     LEFT JOIN routes r ON r.id=q.route_id
     LEFT JOIN vendors v ON v.id=q.vendor_id
     LEFT JOIN vendors bv ON bv.id=q.blending_vendor_id
     LEFT JOIN countries co ON co.id=q.country_id
     LEFT JOIN messages m ON m.id=q.message_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY q.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  // total for pagination
  const countParams = params.slice(0, -2);
  const [cnt] = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM dlr_delay_queue q ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
    countParams,
  ).catch(() => [{ n: '0' }]);
  res.json({ logs: rows, total: Number(cnt.n), limit, offset });
});

// ── Export CSV ───────────────────────────────────────────────────────────────
router.get('/logs/export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, ...vals: unknown[]): void => {
    const slots = vals.map((v) => { params.push(v); return `$${params.length}`; });
    let i = 0;
    where.push(sql.replace(/\?/g, () => slots[i++] ?? '?'));
  };
  if (q.client_id) add('q.client_id = ?', q.client_id);
  if (q.route_id) add('q.route_id = ?', q.route_id);
  if (q.vendor_id) add('q.vendor_id = ?', q.vendor_id);
  if (q.from) add('q.created_at >= ?', q.from);
  if (q.to) add('q.created_at <= ?', q.to);
  const rows = await query<Record<string, unknown>>(
    `SELECT q.message_id, q.original_status, q.selected, q.configured_percentage, q.configured_interval,
            q.delay_seconds, q.received_at, q.release_at, q.released_at, q.queue_status,
            c.name AS client_name, r.name AS route_name, v.name AS vendor_name
     FROM dlr_delay_queue q
     LEFT JOIN clients c ON c.id=q.client_id
     LEFT JOIN routes r ON r.id=q.route_id
     LEFT JOIN vendors v ON v.id=q.vendor_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY q.created_at DESC LIMIT 10000`,
    params,
  );
  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="dlr-cutting-logs.csv"');
  res.write('Message ID,Client,Route,Vendor,Original Status,Selected,Percentage,Interval,Delay(s),Received At,Release At,Released At,Queue Status\n');
  for (const r of rows) {
    res.write([
      esc(r.message_id), esc(r.client_name), esc(r.route_name), esc(r.vendor_name),
      esc(r.original_status), esc(String(r.selected)), esc(String(r.configured_percentage ?? '')),
      esc(String(r.configured_interval ?? '')), esc(String(r.delay_seconds ?? '')),
      esc(r.received_at), esc(r.release_at), esc(r.released_at), esc(r.queue_status),
    ].join(',') + '\n');
  }
  res.end();
});

// ── Queue health ─────────────────────────────────────────────────────────────
router.get('/queue/health', async (_req, res) => {
  const [queued] = await query<{ n: string }>(`SELECT COUNT(*) AS n FROM dlr_delay_queue WHERE queue_status='queued'`).catch(() => [{ n: '0' }]);
  const [failed] = await query<{ n: string }>(`SELECT COUNT(*) AS n FROM dlr_delay_queue WHERE queue_status='failed'`).catch(() => [{ n: '0' }]);
  const [released] = await query<{ n: string }>(`SELECT COUNT(*) AS n FROM dlr_delay_queue WHERE queue_status='released'`).catch(() => [{ n: '0' }]);
  const overdue = await query(
    `SELECT COUNT(*) AS n FROM dlr_delay_queue WHERE queue_status='queued' AND release_at < now() - interval '2 minutes'`,
  ).then((r) => Number((r[0] as { n: string }).n)).catch(() => 0);
  res.json({
    queued: Number(queued.n),
    failed: Number(failed.n),
    released: Number(released.n),
    overdue,
  });
});

// ── Retry failed queue jobs (re-enqueue) ─────────────────────────────────────
router.post('/queue/retry-failed', requirePerm('routes.update'), audit('retried_dlr_cutting_failed', 'dlr_cutting_config'), async (_req, res) => {
  const pool = getPool();
  const failed = await query<{ id: string; message_id: string; delay_seconds: number }>(
    `SELECT id, message_id, delay_seconds FROM dlr_delay_queue WHERE queue_status='failed' LIMIT 100`,
  );
  let retried = 0;
  for (const row of failed) {
    await pool.query(
      `UPDATE dlr_delay_queue SET queue_status='queued', release_at=now() + ($2 || ' seconds')::interval, attempts=0, last_error=NULL, updated_at=now() WHERE id=$1`,
      [row.id, String(row.delay_seconds)],
    );
    // enqueue delayed BullMQ job for immediate retry path (dlr-worker will also drain overdue on boot)
    try {
      const { getQueue, QUEUES } = await import('@8xtel/core');
      await getQueue(QUEUES.dlrDelay).add('release', { queue_id: row.id, message_id: row.message_id }, { delay: row.delay_seconds * 1000, jobId: `retry-${row.id}-${Date.now()}` });
    } catch { /* best effort */ }
    retried++;
  }
  res.json({ retried });
});

export default router;
