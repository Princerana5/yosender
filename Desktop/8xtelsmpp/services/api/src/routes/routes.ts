import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('routes.read'));

router.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT r.*, c.name AS country_name, cl.name AS client_name,
       (SELECT json_agg(t ORDER BY t.priority) FROM (
          SELECT rv.priority, rv.weight, rv.vendor_id, v.name AS vendor_name, v.status AS vendor_status
          FROM route_vendors rv JOIN vendors v ON v.id=rv.vendor_id WHERE rv.route_id=r.id
        ) t) AS vendors,
       (SELECT min(vr.cost) FROM vendor_rates vr JOIN route_vendors rv2 ON rv2.vendor_id=vr.vendor_id
        WHERE rv2.route_id=r.id AND (vr.country_id IS NULL OR vr.country_id=r.country_id)) AS min_vendor_cost,
       (SELECT count(*) FROM messages m WHERE m.route_id=r.id AND m.created_at >= now() - interval '24 hours') AS msgs_24h,
       (SELECT count(*) FROM messages m WHERE m.route_id=r.id AND m.created_at >= now() - interval '7 days') AS msgs_7d,
       (SELECT count(*) FROM filters f WHERE f.reroute_id=r.id) AS filter_refs,
       (SELECT count(*) FROM traffic_policies tp WHERE tp.route_id=r.id) AS policy_count
     FROM routes r
     LEFT JOIN countries c ON c.id=r.country_id
     LEFT JOIN clients cl ON cl.id=r.client_id
     ORDER BY r.created_at DESC`,
  );
  // Warn-only margin flag: price below cost×(1+margin) → below_margin=true + floor.
  // Sends are NEVER blocked; the badge tells you the route loses money.
  res.json({ routes: (rows as Record<string, unknown>[]).map((r) => {
    const price = r.price_per_segment !== null && r.price_per_segment !== undefined ? Number(r.price_per_segment) : null;
    const cost = r.min_vendor_cost !== null && r.min_vendor_cost !== undefined ? Number(r.min_vendor_cost) : null;
    const margin = r.min_margin_pct !== null && r.min_margin_pct !== undefined ? Number(r.min_margin_pct) : null;
    const floor = cost !== null && margin !== null ? +(cost * (1 + margin / 100)).toFixed(6) : null;
    return {
      ...r,
      margin_floor: floor,
      below_margin: price !== null && floor !== null ? price < floor : false,
    };
  }) });
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
  price_per_segment: z.number().nonnegative().nullable().optional(),
  price_currency: z.enum(['USD', 'EUR', 'INR']).optional(),
  min_margin_pct: z.number().min(0).max(1000).nullable().optional(),
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
    `INSERT INTO routes (name, channel, client_id, country_id, prefix, sender_id, strategy, status, tps_limit, group_id, price_per_segment, price_currency, min_margin_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [b.name, b.channel, b.client_id ?? null, b.country_id ?? null, b.prefix ?? null, b.sender_id ?? null,
     b.strategy, b.status, b.tps_limit ?? null, b.group_id ?? null,
     b.price_per_segment ?? null, b.price_currency ?? 'USD', b.min_margin_pct ?? null],
  );
  const route = rows[0];
  for (const v of b.vendors) {
    await pool.query(
      'INSERT INTO route_vendors (route_id, vendor_id, priority, weight) VALUES ($1,$2,$3,$4) ON CONFLICT (route_id, vendor_id) DO UPDATE SET priority=EXCLUDED.priority, weight=EXCLUDED.weight',
      [route.id, v.vendor_id, v.priority, v.weight],
    );
  }
  res.status(201).json({ route });
});

router.patch('/:id', requirePerm('routes.update'), audit('updated_route', 'route'), async (req, res) => {
  const allowed = ['name', 'channel', 'client_id', 'country_id', 'prefix', 'sender_id', 'strategy', 'status', 'tps_limit', 'group_id', 'price_per_segment', 'price_currency', 'min_margin_pct'] as const;
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

// ── Single route detail: chain, usage, references ──────────────────────────
// Powers the professional route drawer: who it serves, how much traffic it
// carries, and what would break if it were deleted/disabled.
// NOTE: registered AFTER /groups so the literal "groups" path isn't
// swallowed by the :id param.
router.get('/:id', async (req, res) => {
  const route = await queryOne<Record<string, unknown>>(
    `SELECT r.*, c.name AS country_name, cl.name AS client_name,
       (SELECT json_agg(t ORDER BY t.priority) FROM (
          SELECT rv.priority, rv.weight, rv.vendor_id, v.name AS vendor_name, v.status AS vendor_status, v.tps
          FROM route_vendors rv JOIN vendors v ON v.id=rv.vendor_id WHERE rv.route_id=r.id
        ) t) AS vendors,
       (SELECT count(*) FROM messages m WHERE m.route_id=r.id AND m.created_at >= now() - interval '24 hours') AS msgs_24h,
       (SELECT count(*) FROM messages m WHERE m.route_id=r.id AND m.created_at >= now() - interval '7 days') AS msgs_7d,
       (SELECT count(*) FROM messages m WHERE m.route_id=r.id AND m.created_at >= now() - interval '7 days'
         AND m.status='delivered') AS delivered_7d,
       (SELECT count(*) FROM filters f WHERE f.reroute_id=r.id) AS filter_refs,
       (SELECT count(*) FROM traffic_policies tp WHERE tp.route_id=r.id) AS policy_count,
       (SELECT count(*) FROM route_client_exclusions x WHERE x.route_id=r.id) AS exclusion_count
     FROM routes r
     LEFT JOIN countries c ON c.id=r.country_id
     LEFT JOIN clients cl ON cl.id=r.client_id
     WHERE r.id=$1`,
    [req.params.id],
  );
  if (!route) {
    res.status(404).json({ error: 'route not found' });
    return;
  }
  const servedClients = route.client_id
    ? await query('SELECT id, name, system_id FROM clients WHERE id=$1', [route.client_id as string])
    : await query(
      `SELECT c.id, c.name, c.system_id FROM clients c WHERE c.status='active'
       AND NOT EXISTS (SELECT 1 FROM route_client_exclusions x WHERE x.route_id=$1 AND x.client_id=c.id)
       ORDER BY c.name LIMIT 200`,
      [req.params.id],
    );
  const excluded = route.client_id
    ? []
    : await query(
      `SELECT c.id, c.name, c.system_id, x.created_at AS excluded_at
       FROM route_client_exclusions x JOIN clients c ON c.id=x.client_id
       WHERE x.route_id=$1 ORDER BY c.name`,
      [req.params.id],
    );
  res.json({ route, served_clients: servedClients, served_count: servedClients.length, excluded });
});

// ── Detach a GLOBAL route from ONE client (safe removal) ───────────────────
// Inserts a route_client_exclusions row instead of deleting the route, so the
// route keeps serving everyone else. Dedicated routes can't be detached —
// they only ever served that one client, so DELETE is the right call.
// Idempotent: detaching twice is a no-op.
router.post('/:id/detach', requirePerm('routes.update'), audit('detached_route_client', 'route'), async (req, res) => {
  const { client_id } = (req.body ?? {}) as { client_id?: string };
  if (!client_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id)) {
    res.status(400).json({ error: 'provide body.client_id (uuid)' });
    return;
  }
  const route = await queryOne<{ id: string; name: string; client_id: string | null }>(
    'SELECT id, name, client_id FROM routes WHERE id=$1', [req.params.id],
  );
  if (!route) {
    res.status(404).json({ error: 'route not found' });
    return;
  }
  if (route.client_id) {
    res.status(422).json({
      error: 'route is dedicated to one client — detach does not apply; DELETE it instead',
      dedicated_to: route.client_id,
    });
    return;
  }
  const client = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM clients WHERE id=$1', [client_id],
  );
  if (!client) {
    res.status(404).json({ error: 'client not found' });
    return;
  }
  await getPool().query(
    'INSERT INTO route_client_exclusions (route_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.id, client_id],
  );
  res.json({ ok: true, detached: { route_id: req.params.id, route_name: route.name, client_id, client_name: client.name } });
});

// ── Re-attach a previously detached client to a global route ───────────────
router.post('/:id/attach', requirePerm('routes.update'), audit('attached_route_client', 'route'), async (req, res) => {
  const { client_id } = (req.body ?? {}) as { client_id?: string };
  if (!client_id) {
    res.status(400).json({ error: 'provide body.client_id (uuid)' });
    return;
  }
  const r = await getPool().query(
    'DELETE FROM route_client_exclusions WHERE route_id=$1 AND client_id=$2', [req.params.id, client_id],
  );
  res.json({ ok: true, reattached: (r.rowCount ?? 0) > 0 });
});

router.delete('/:id', requirePerm('routes.delete'), audit('deleted_route', 'route'), async (req, res) => {
  const route = await queryOne<{ id: string; name: string; client_id: string | null }>(
    'SELECT id, name, client_id FROM routes WHERE id=$1', [req.params.id],
  );
  if (!route) {
    res.status(404).json({ error: 'route not found' });
    return;
  }
  // filters.reroute_id has no ON DELETE CASCADE — refuse rather than orphan.
  const refs = await queryOne<{ n: string }>(
    'SELECT count(*) AS n FROM filters WHERE reroute_id=$1', [req.params.id],
  );
  if (Number(refs?.n ?? 0) > 0) {
    res.status(409).json({ error: 'route is referenced by traffic filters (reroute); remove those first' });
    return;
  }
  // Guard: deleting a GLOBAL route with recent traffic (or serving many
  // clients) requires explicit ?force=true — the UI surfaces this as a
  // type-to-confirm step with impact stats. Prevents the classic "deleted
  // from one client, wiped for everyone" accident.
  const force = (req.query as Record<string, string>).force === 'true';
  if (!route.client_id && !force) {
    const [usage] = await query<{ msgs_7d: string; clients: string }>(
      `SELECT (SELECT count(*) FROM messages m WHERE m.route_id=$1 AND m.created_at >= now() - interval '7 days') AS msgs_7d,
              (SELECT count(*) FROM clients c WHERE c.status='active'
               AND NOT EXISTS (SELECT 1 FROM route_client_exclusions x WHERE x.route_id=$1 AND x.client_id=c.id)) AS clients`,
      [req.params.id],
    );
    if (Number(usage.msgs_7d) > 0 || Number(usage.clients) > 1) {
      res.status(409).json({
        error: 'global route with live impact — confirm required',
        impact: {
          msgs_7d: Number(usage.msgs_7d),
          clients_served: Number(usage.clients),
          hint: 'Detach it from one client via POST /routes/:id/detach, disable it via PATCH status=disabled, or retry with ?force=true + typed confirmation.',
        },
      });
      return;
    }
  }
  // route_vendors + traffic_policies + exclusions cascade; messages keep route_id history untouched.
  await query('DELETE FROM routes WHERE id=$1', [req.params.id]);
  res.json({ deleted: route.id });
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
