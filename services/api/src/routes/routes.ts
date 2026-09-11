import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('routes.read'));

router.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT r.*, c.name AS country_name,
       (SELECT json_agg(rv ORDER BY rv.priority) FROM route_vendors rv WHERE rv.route_id=r.id) AS vendors
     FROM routes r LEFT JOIN countries c ON c.id=r.country_id ORDER BY r.created_at DESC`,
  );
  res.json({ routes: rows });
});

const routeSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(['sms', 'whatsapp', 'rcs']).default('sms'),
  client_id: z.string().uuid().nullable().optional(),
  country_id: z.string().uuid().nullable().optional(),
  prefix: z.string().nullable().optional(),
  sender_id: z.string().nullable().optional(),
  strategy: z.enum(['priority', 'failover', 'round_robin', 'least_cost', 'percentage']).default('priority'),
  status: z.enum(['active', 'disabled']).default('active'),
  tps_limit: z.number().int().positive().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  vendors: z.array(z.object({
    vendor_id: z.string().uuid(),
    priority: z.number().int().default(1),
    weight: z.number().int().min(1).max(100).default(100),
  })).default([]),
});

router.post('/', requirePerm('routes.create'), audit('created_route', 'route'), async (req, res) => {
  const parsed = routeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO routes (name, channel, client_id, country_id, prefix, sender_id, strategy, status, tps_limit, group_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.name, b.channel, b.client_id ?? null, b.country_id ?? null, b.prefix ?? null, b.sender_id ?? null,
     b.strategy, b.status, b.tps_limit ?? null, b.group_id ?? null],
  );
  const route = rows[0];
  for (const v of b.vendors) {
    await pool.query(
      'INSERT INTO route_vendors (route_id, vendor_id, priority, weight) VALUES ($1,$2,$3,$4) ON CONFLICT DO UPDATE SET priority=EXCLUDED.priority, weight=EXCLUDED.weight',
      [route.id, v.vendor_id, v.priority, v.weight],
    );
  }
  res.status(201).json({ route });
});

router.patch('/:id', requirePerm('routes.update'), audit('updated_route', 'route'), async (req, res) => {
  const allowed = ['name', 'channel', 'client_id', 'country_id', 'prefix', 'sender_id', 'strategy', 'status', 'tps_limit', 'group_id'] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) {
      params.push(req.body[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (req.body?.vendors) {
    const pool = getPool();
    await pool.query('DELETE FROM route_vendors WHERE route_id=$1', [req.params.id]);
    for (const v of req.body.vendors as Array<{ vendor_id: string; priority: number; weight: number }>) {
      await pool.query('INSERT INTO route_vendors (route_id, vendor_id, priority, weight) VALUES ($1,$2,$3,$4)', [
        req.params.id, v.vendor_id, v.priority ?? 1, v.weight ?? 100,
      ]);
    }
  }
  if (!sets.length && !req.body?.vendors) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  params.push(req.params.id);
  const rows = sets.length
    ? await query(`UPDATE routes SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params)
    : await query('SELECT * FROM routes WHERE id=$1', [req.params.id]);
  res.json({ route: rows[0] ?? null });
});

router.get('/groups', async (_req, res) => {
  res.json({ groups: await query('SELECT * FROM route_groups ORDER BY name') });
});

router.post('/groups', requirePerm('routes.create'), audit('created_route_group', 'route_group'), async (req, res) => {
  const parsed = z.object({ name: z.string().min(1), description: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const rows = await query('INSERT INTO route_groups (name, description) VALUES ($1,$2) RETURNING *', [
    parsed.data.name, parsed.data.description ?? null,
  ]);
  res.status(201).json({ group: rows[0] });
});

// ── Traffic policies (§19) ──────────────────────────────────────────────────
router.get('/:id/policies', async (req, res) => {
  res.json({ policies: await query('SELECT * FROM traffic_policies WHERE route_id=$1 ORDER BY created_at', [req.params.id]) });
});

router.post('/:id/policies', requirePerm('routes.update'), audit('created_traffic_policy', 'traffic_policy'), async (req, res) => {
  const parsed = z.object({
    name: z.string().min(1),
    vendor_id: z.string().uuid().nullable().optional(),
    percentage: z.number().int().min(0).max(100).default(100),
    report_policy: z.enum(['actual', 'sampled']).default('actual'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const rows = await query(
    'INSERT INTO traffic_policies (name, route_id, vendor_id, percentage, report_policy) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [parsed.data.name, req.params.id, parsed.data.vendor_id ?? null, parsed.data.percentage, parsed.data.report_policy],
  );
  res.status(201).json({ policy: rows[0] });
});

export function routeRouter(): Router {
  return router;
}

export default router;
