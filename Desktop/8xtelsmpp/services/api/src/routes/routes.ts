import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { CLEAR_ROUTE_CLIENT_EXCLUSION_SQL, EXCLUDE_ROUTE_CLIENT_SQL, REMOVE_ROUTE_CLIENT_RATES_SQL, shouldExcludeAfterMemberRemoval } from '../lib/route-client-access.js';

const router = Router();
router.use(requirePerm('routes.read'));

// Scope helper: global (no members) vs member list. Returned on every route
// so the UI can render 🌍 Global / 👥 N clients without extra round-trips.
const SCOPE_SQL = `
  (SELECT COALESCE(json_agg(m ORDER BY m.client_name), '[]') FROM (
     SELECT rc.client_id, c.name AS client_name, c.system_id
     FROM route_clients rc JOIN clients c ON c.id=rc.client_id
     WHERE rc.route_id=r.id
   ) m) AS member_clients,
  (SELECT count(*) FROM route_clients rc WHERE rc.route_id=r.id) AS member_count
`;

router.get('/', async (req, res) => {
  const q = req.query as { vendor_id?: string };
  const vendorId = q.vendor_id?.trim() || null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (vendorId && !uuidRe.test(vendorId)) {
    res.status(400).json({ error: 'invalid vendor_id' });
    return;
  }
  const whereVendor = vendorId ? `WHERE EXISTS (SELECT 1 FROM route_vendors rv WHERE rv.route_id=r.id AND rv.vendor_id=$1)` : '';
  const params: unknown[] = vendorId ? [vendorId] : [];
  const rows = await query(
    `SELECT r.*, c.name AS country_name, cl.name AS client_name,
       (SELECT t.name FROM otp_templates t WHERE t.id=r.otp_default_template_id) AS otp_default_template_name,
       (SELECT json_agg(t ORDER BY t.priority) FROM (
          SELECT rv.priority, rv.weight, rv.vendor_id, v.name AS vendor_name, v.status AS vendor_status
          FROM route_vendors rv JOIN vendors v ON v.id=rv.vendor_id WHERE rv.route_id=r.id
        ) t) AS vendors,
       (SELECT min(vr.cost) FROM vendor_rates vr JOIN route_vendors rv2 ON rv2.vendor_id=vr.vendor_id
        WHERE rv2.route_id=r.id AND (vr.country_id IS NULL OR vr.country_id=r.country_id)) AS min_vendor_cost,
       (SELECT count(*) FROM messages m WHERE m.route_id=r.id AND m.created_at >= now() - interval '24 hours') AS msgs_24h,
       (SELECT count(*) FROM messages m WHERE m.route_id=r.id AND m.created_at >= now() - interval '7 days') AS msgs_7d,
       (SELECT count(*) FROM filters f WHERE f.reroute_id=r.id) AS filter_refs,
       (SELECT count(*) FROM traffic_policies tp WHERE tp.route_id=r.id) AS policy_count,
       (SELECT count(*) FROM route_client_rates rcr WHERE rcr.route_id=r.id) AS route_client_rate_count,
       (SELECT COALESCE(json_agg(t ORDER BY t.client_name), '[]') FROM (
          SELECT rcr.price_per_segment, rcr.currency, rcr.pricing_mode, c2.name AS client_name, c2.system_id, rcr.client_id
          FROM route_client_rates rcr JOIN clients c2 ON c2.id=rcr.client_id WHERE rcr.route_id=r.id
        ) t) AS client_rates,
       ${SCOPE_SQL}
     FROM routes r
     LEFT JOIN countries c ON c.id=r.country_id
     LEFT JOIN clients cl ON cl.id=r.client_id
     ${whereVendor}
     ORDER BY r.created_at DESC`,
    params,
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
  route_code: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/, 'Route Code: A-Z 0-9 _ - only, e.g. IN-SMS-001'),
  channel: z.enum(['sms', 'whatsapp', 'rcs']).default('sms'),
  client_id: z.string().uuid().nullable().optional(),
  client_ids: z.array(z.string().uuid()).optional(),
  country_id: z.string().uuid().nullable().optional(),
  prefix: z.string().nullable().optional(),
  sender_id: z.string().nullable().optional(),
  strategy: z.enum(['priority', 'failover', 'round_robin', 'least_cost', 'percentage']).default('priority'),
  status: z.enum(['active', 'disabled']).default('active'),
  tps_limit: z.number().int().positive().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  price_per_segment: z.number().nonnegative().nullable().optional(),
  price_currency: z.enum(['EUR', 'USD']).optional(),
  internal_vendor_cost: z.number().nonnegative().nullable().optional(),
  internal_cost_currency: z.enum(['EUR', 'USD']).optional(),
  route_type: z.enum(['generic', 'sms', 'otp', 'promotional', 'transactional', 'direct', 'wholesale']).optional(),
  currency: z.enum(['EUR', 'USD']).optional(),
  description: z.string().max(500).nullable().optional(),
  min_margin_pct: z.number().min(0).max(1000).nullable().optional(),
  vendors: z.array(z.object({
    vendor_id: z.string().uuid(),
    priority: z.number().int().default(1),
    weight: z.number().int().min(1).max(100).default(100),
  })).default([]),
});

// Resolve the membership list for create/update: explicit client_ids wins;
// legacy single client_id maps to a 1-member list; absent/empty = global.
function resolveMembers(body: { client_ids?: string[]; client_id?: string | null }): string[] {
  if (Array.isArray(body.client_ids)) return [...new Set(body.client_ids)];
  if (body.client_id) return [body.client_id];
  return [];
}

router.post('/', requirePerm('routes.create'), audit('created_route', 'route'), async (req, res) => {
  const parsed = routeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const pool = getPool();
  const members = resolveMembers(b);
  try {
    const { rows } = await pool.query(
      `INSERT INTO routes (name, route_code, channel, client_id, country_id, prefix, sender_id, strategy, traffic_mode, status, tps_limit, group_id, price_per_segment, price_currency, internal_vendor_cost, internal_cost_currency, route_type, currency, description, min_margin_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [b.name, b.route_code.toUpperCase(), b.channel, members.length === 1 ? members[0] : null, b.country_id ?? null, b.prefix ?? null, b.sender_id ?? null,
       b.strategy, b.strategy, b.status, b.tps_limit ?? null, b.group_id ?? null,
       b.price_per_segment ?? null, b.price_currency ?? 'EUR', b.internal_vendor_cost ?? null, b.internal_cost_currency ?? 'EUR',
       b.route_type ?? 'generic', b.currency ?? 'EUR', b.description ?? null, b.min_margin_pct ?? null],
    );
    const route = rows[0];
    for (const cid of members) {
      await pool.query(
        'INSERT INTO route_clients (route_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [route.id, cid],
      );
    }
    for (const v of b.vendors) {
      await pool.query(
        'INSERT INTO route_vendors (route_id, vendor_id, priority, weight) VALUES ($1,$2,$3,$4) ON CONFLICT (route_id, vendor_id) DO UPDATE SET priority=EXCLUDED.priority, weight=EXCLUDED.weight',
        [route.id, v.vendor_id, v.priority, v.weight],
      );
    }
    res.status(201).json({ route });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') { res.status(409).json({ error: 'Route Code already exists — must be unique (e.g. IN-SMS-001)' }); return; }
    throw e;
  }
});

router.patch('/:id', requirePerm('routes.update'), audit('updated_route', 'route'), async (req, res) => {
  const allowed = ['name', 'route_code', 'channel', 'country_id', 'prefix', 'sender_id', 'strategy', 'traffic_mode', 'status', 'tps_limit', 'group_id', 'price_per_segment', 'price_currency', 'internal_vendor_cost', 'internal_cost_currency', 'route_type', 'currency', 'description', 'min_margin_pct',
    'otp_transform_enabled', 'otp_default_template_id', 'otp_on_no_otp', 'otp_on_no_template'] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) {
      let v: unknown = req.body[k];
      if (k === 'route_code' && typeof v === 'string') v = v.toUpperCase();
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
  }
  // Keep traffic_mode in sync with strategy: saving the distribution editor
  // with strategy=percentage must also flip traffic_mode, otherwise the
  // routing engine (which prefers traffic_mode over strategy) stays on priority
  // and all traffic goes to the P1 vendor despite the UI showing 50/50.
  if (req.body?.strategy !== undefined && req.body?.traffic_mode === undefined) {
    params.push(req.body.strategy);
    sets.push(`traffic_mode = $${params.length}`);
  }
  const pool = getPool();
  // Membership replace: client_ids (multi-select) or legacy single client_id.
  // [] / null = make global. Keeps the legacy column in sync (1 member → set, else NULL).
  let members: string[] | null = null;
  if (req.body?.client_ids !== undefined || req.body?.client_id !== undefined) {
    members = Array.isArray(req.body?.client_ids)
      ? [...new Set(req.body.client_ids as string[])]
      : req.body?.client_id ? [req.body.client_id as string] : [];
    await pool.query('DELETE FROM route_clients WHERE route_id=$1', [req.params.id]);
    for (const cid of members) {
      await pool.query('INSERT INTO route_clients (route_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, cid]);
    }
    params.push(members.length === 1 ? members[0] : null);
    sets.push(`client_id = $${params.length}`);
  }
  if (req.body?.vendors) {
    await pool.query('DELETE FROM route_vendors WHERE route_id=$1', [req.params.id]);
    for (const v of req.body.vendors as Array<{ vendor_id: string; priority: number; weight: number }>) {
      await pool.query('INSERT INTO route_vendors (route_id, vendor_id, priority, weight) VALUES ($1,$2,$3,$4)', [
        req.params.id, v.vendor_id, v.priority ?? 1, v.weight ?? 100,
      ]);
    }
  }
  if (!sets.length && !req.body?.vendors && members === null) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  params.push(req.params.id);
  let rows: unknown[];
  try {
    rows = sets.length
      ? await query(`UPDATE routes SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params)
      : await query('SELECT * FROM routes WHERE id=$1', [req.params.id]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') { res.status(409).json({ error: 'Route Code already exists — must be unique' }); return; }
    throw e;
  }
  res.json({ route: rows[0] ?? null });
});

router.get('/groups', async (_req, res) => {
  res.json({ groups: await query('SELECT * FROM route_groups ORDER BY name') });
});

// ── OTP templates: literal paths FIRST (before /:id swallows them) ─────────
const OTP_LIST_SQL = `
  SELECT t.*,
    (SELECT count(*) FROM messages m WHERE m.otp_template_id=t.id AND m.created_at >= now() - interval '7 days') AS usage_7d,
    (SELECT count(*) FROM route_otp_clients m WHERE m.template_id=t.id) AS client_maps
  FROM otp_templates t ORDER BY t.is_default DESC, t.created_at DESC
`;

router.get('/otp-templates', async (_req, res) => {
  res.json({ templates: await query(OTP_LIST_SQL) });
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

// ── Profitability & rate history: LITERAL paths BEFORE /:id ────────────────
router.get('/profitability/summary', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { dashboardFinancials } = await import('@8xtel/core');
  const fin = await dashboardFinancials({ from: q.from, to: q.to, currency: q.currency ?? undefined });
  res.json(fin);
});
router.get('/profitability/by-route', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { profitabilityByRoute } = await import('@8xtel/core');
  res.json({ rows: await profitabilityByRoute({ from: q.from, to: q.to, currency: q.currency ?? undefined, clientId: q.client_id as string | undefined, countryId: q.country_id as string | undefined }) });
});
router.get('/profitability/by-client', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { profitabilityByClient } = await import('@8xtel/core');
  res.json({ rows: await profitabilityByClient({ from: q.from, to: q.to, currency: q.currency ?? undefined, routeId: q.route_id as string | undefined, countryId: q.country_id as string | undefined }) });
});
router.get('/profitability/by-country', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { profitabilityByCountry } = await import('@8xtel/core');
  res.json({ rows: await profitabilityByCountry({ from: q.from, to: q.to, currency: q.currency ?? undefined }) });
});
router.get('/rate-history/all', async (req, res) => {
  const q = req.query as Record<string, string>;
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (q.client_id) { conds.push(`h.client_id=$${i++}`); params.push(q.client_id); }
  if (q.route_id) { conds.push(`h.route_id=$${i++}`); params.push(q.route_id); }
  if (q.country_id) { conds.push(`h.country_id=$${i++}`); params.push(q.country_id); }
  if (q.from) { conds.push(`h.changed_at >= $${i++}::date`); params.push(q.from); }
  if (q.to) { conds.push(`h.changed_at <= $${i++}::date + interval '1 day'`); params.push(q.to); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await query(
    `SELECT h.*, c.name AS client_name, r.name AS route_name, r.route_code, co.name AS country_name
     FROM route_rate_history h
     JOIN clients c ON c.id=h.client_id
     JOIN routes r ON r.id=h.route_id
     LEFT JOIN countries co ON co.id=h.country_id
     ${where} ORDER BY h.changed_at DESC LIMIT 500`, params,
  );
  res.json({ history: rows });
});
router.get('/portal/my-rates', async (req, res) => {
  const user = (req as unknown as { user?: { id?: string; kind?: string; client_id?: string } }).user;
  const clientId = user?.client_id ?? (req.query.client_id as string | undefined);
  if (!clientId) { res.status(400).json({ error: 'client_id required' }); return; }
  if (user?.kind === 'portal' && user.client_id !== clientId) { res.status(403).json({ error: 'forbidden' }); return; }
  const rows = await query(
    `SELECT r.route_code, r.name AS route_name, co.name AS country_name, co.iso_code,
            rcr.price_per_segment AS your_rate, rcr.currency, rcr.effective_from
     FROM route_client_rates rcr
     JOIN routes r ON r.id=rcr.route_id
     LEFT JOIN countries co ON co.id=rcr.country_id
     WHERE rcr.client_id=$1 ORDER BY r.route_code, co.name`, [clientId],
  );
  res.json({ rates: rows });
});

// ── Aggregated vendor rates for a route (drawer: Vendors & Cost) ──────
router.get('/:id/vendor-rates', async (req, res) => {
  const route = await queryOne<{ id: string; internal_vendor_cost: string | null; internal_cost_currency: string | null }>(
    'SELECT id, internal_vendor_cost, internal_cost_currency FROM routes WHERE id=$1', [req.params.id],
  );
  if (!route) { res.status(404).json({ error: 'route not found' }); return; }
  const vids = await query<{ vendor_id: string }>('SELECT vendor_id FROM route_vendors WHERE route_id=$1', [req.params.id]);
  const ids = vids.map((r) => r.vendor_id);
  let rates: unknown[] = [];
  if (ids.length) {
    try {
      rates = await query(
        `SELECT vr.id, vr.vendor_id, v.name AS vendor_name, vr.country_id, c.name AS country_name, c.iso_code,
                vr.prefix, vr.operator, vr.cost, vr.currency, vr.updated_at
         FROM vendor_rates vr JOIN vendors v ON v.id=vr.vendor_id LEFT JOIN countries c ON c.id=vr.country_id
         WHERE vr.vendor_id = ANY($1::uuid[]) ORDER BY v.name, length(COALESCE(vr.prefix,'')) DESC LIMIT 500`,
        [ids],
      );
    } catch { rates = []; }
  }
  res.json({ route, vendor_ids: ids, rates });
});

// ── Single route detail: chain, usage, references ──────────────────────────
// Powers the professional route drawer: who it serves, how much traffic it
// carries, and what would break if it were deleted/disabled.
// NOTE: registered AFTER /groups AND /otp-templates so those literal paths
// aren't swallowed by the :id param (Express matches in registration order).
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
       (SELECT count(*) FROM route_client_exclusions x WHERE x.route_id=r.id) AS exclusion_count,
       ${SCOPE_SQL}
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
  const memberCount = Number((route as { member_count?: string }).member_count ?? 0);
  // Global (no members): serves all active clients minus exclusions.
  // Member route: serves exactly the member list.
  const servedClients = memberCount === 0
    ? await query(
      `SELECT c.id, c.name, c.system_id FROM clients c WHERE c.status='active'
       AND NOT EXISTS (SELECT 1 FROM route_client_exclusions x WHERE x.route_id=$1 AND x.client_id=c.id)
       ORDER BY c.name LIMIT 200`,
      [req.params.id],
    )
    : await query(
      `SELECT c.id, c.name, c.system_id FROM route_clients rc
       JOIN clients c ON c.id=rc.client_id WHERE rc.route_id=$1 ORDER BY c.name`,
      [req.params.id],
    );
  const excluded = memberCount === 0
    ? await query(
      `SELECT c.id, c.name, c.system_id, x.created_at AS excluded_at
       FROM route_client_exclusions x JOIN clients c ON c.id=x.client_id
       WHERE x.route_id=$1 ORDER BY c.name`,
      [req.params.id],
    )
    : [];
  // All active clients NOT yet members — for the add-member picker.
  const available = memberCount === 0
    ? []
    : await query(
      `SELECT c.id, c.name, c.system_id FROM clients c WHERE c.status='active'
       AND NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=$1 AND rc.client_id=c.id)
       ORDER BY c.name LIMIT 200`,
      [req.params.id],
    );
  res.json({ route, served_clients: servedClients, served_count: memberCount === 0 ? servedClients.length : memberCount, excluded, available });
});

// ── OTP Template Manager (India HSP route transformation) ──────────────────
// NOTE: every /otp-templates + /:id/otp-clients route MUST be registered
// BEFORE `/:id`-style routes below — Express matches in registration order,
// and `/:id` would otherwise swallow the literal "otp-templates" segment
// (GET /routes/otp-templates → route-not-found, empty list, silent POST fail).
// Templates hold the vendor-approved SID + DLT text with an {OTP} placeholder.
// Only status='active' rows are eligible at send time; the routing worker
// resolves per-client mapping → route default.
const otpSchema = z.object({
  name: z.string().min(1).max(120),
  template_ref: z.string().max(120).nullable().optional(),
  sender_id: z.string().min(1).max(21),
  content: z.string().min(1).max(1000),
  otp_placeholder: z.string().min(1).max(20).default('{OTP}'),
  status: z.enum(['active', 'inactive']).default('active'),
  is_default: z.boolean().default(false),
});

router.post('/otp-templates', requirePerm('routes.create'), audit('created_otp_template', 'otp_template'), async (req, res) => {
  const parsed = otpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  if (!b.content.includes(b.otp_placeholder)) {
    res.status(400).json({ error: `content must contain the placeholder ${b.otp_placeholder}` });
    return;
  }
  const pool = getPool();
  if (b.is_default) await pool.query(`UPDATE otp_templates SET is_default=false`);
  const { rows } = await pool.query(
    `INSERT INTO otp_templates (name, template_ref, sender_id, content, otp_placeholder, status, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.name, b.template_ref ?? null, b.sender_id.trim(), b.content, b.otp_placeholder, b.status, b.is_default],
  );
  res.status(201).json({ template: rows[0] });
});

router.patch('/otp-templates/:tid', requirePerm('routes.update'), audit('updated_otp_template', 'otp_template'), async (req, res) => {
  const parsed = otpSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const cur = await queryOne<Record<string, unknown>>('SELECT * FROM otp_templates WHERE id=$1', [req.params.tid]);
  if (!cur) {
    res.status(404).json({ error: 'template not found' });
    return;
  }
  const next = { ...(cur as Record<string, unknown>), ...parsed.data };
  if (!String(next.content ?? '').includes(String(next.otp_placeholder ?? '{OTP}'))) {
    res.status(400).json({ error: `content must contain the placeholder ${String(next.otp_placeholder ?? '{OTP}')}` });
    return;
  }
  const pool = getPool();
  if (parsed.data.is_default) await pool.query(`UPDATE otp_templates SET is_default=false WHERE id<>$1`, [req.params.tid]);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of ['name', 'template_ref', 'sender_id', 'content', 'otp_placeholder', 'status', 'is_default'] as const) {
    if ((parsed.data as Record<string, unknown>)[k] !== undefined) {
      params.push((parsed.data as Record<string, unknown>)[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (!sets.length) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  params.push(req.params.tid);
  const { rows } = await pool.query(
    `UPDATE otp_templates SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params,
  );
  res.json({ template: rows[0] });
});

router.delete('/otp-templates/:tid', requirePerm('routes.delete'), audit('deleted_otp_template', 'otp_template'), async (req, res) => {
  // Safe delete: routes referencing it fall back to reject-with-reason (never
  // an inactive template), client mappings are removed.
  const pool = getPool();
  await pool.query('DELETE FROM route_otp_clients WHERE template_id=$1', [req.params.tid]);
  await pool.query('UPDATE routes SET otp_default_template_id=NULL WHERE otp_default_template_id=$1', [req.params.tid]);
  const r = await pool.query('DELETE FROM otp_templates WHERE id=$1', [req.params.tid]);
  if (!r.rowCount) {
    res.status(404).json({ error: 'template not found' });
    return;
  }
  res.json({ ok: true });
});

// Test-render a template against a sample client message: extracts the OTP and
// shows exactly what the vendor would receive. No message is sent.
router.post('/otp-templates/:tid/test', async (req, res) => {
  const tpl = await queryOne<{ sender_id: string; content: string; otp_placeholder: string; status: string; name: string }>(
    'SELECT sender_id, content, otp_placeholder, status, name FROM otp_templates WHERE id=$1', [req.params.tid],
  );
  if (!tpl) {
    res.status(404).json({ error: 'template not found' });
    return;
  }
  const sample = String(req.body?.message ?? '');
  // Same anchored→bare extraction as the routing worker (kept inline so the
  // API has no worker import; keep both in sync).
  const anchored = /(?:otp|one[\s-]?time[\s-]?password|verification(?:\s+code)?|verify(?:\s+code)?|passcode|\bcode\b|\bpin\b)[\s:.\-is]*?(\d{4,6})(?!\d)/i.exec(sample);
  const bare = /(?<!\d)(\d{4,6})(?!\d)/.exec(sample);
  const otp = anchored?.[1] ?? bare?.[1] ?? null;
  if (!otp) {
    res.json({ ok: false, reason: 'no 4-6 digit OTP found in sample message' });
    return;
  }
  res.json({
    ok: true,
    otp,
    vendor_sender: tpl.sender_id,
    vendor_text: tpl.content.split(tpl.otp_placeholder).join(otp),
    template_status: tpl.status,
  });
});

// Per-client template mapping on a route (optional; falls back to route default)
router.get('/:id/otp-clients', async (req, res) => {
  const rows = await query(
    `SELECT m.client_id, c.name AS client_name, c.system_id, m.template_id, t.name AS template_name, t.sender_id
     FROM route_otp_clients m JOIN clients c ON c.id=m.client_id
     JOIN otp_templates t ON t.id=m.template_id WHERE m.route_id=$1 ORDER BY c.name`,
    [req.params.id],
  );
  res.json({ mappings: rows });
});

router.post('/:id/otp-clients', requirePerm('routes.update'), audit('mapped_route_otp_client', 'route'), async (req, res) => {
  const { client_id, template_id } = (req.body ?? {}) as { client_id?: string; template_id?: string };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!client_id || !uuid.test(client_id) || !template_id || !uuid.test(template_id)) {
    res.status(400).json({ error: 'provide body.client_id + body.template_id (uuid)' });
    return;
  }
  const tpl = await queryOne('SELECT id FROM otp_templates WHERE id=$1 AND status=$2', [template_id, 'active']);
  if (!tpl) {
    res.status(400).json({ error: 'template must exist and be active' });
    return;
  }
  await getPool().query(
    `INSERT INTO route_otp_clients (route_id, client_id, template_id) VALUES ($1,$2,$3)
     ON CONFLICT (route_id, client_id) DO UPDATE SET template_id=EXCLUDED.template_id`,
    [req.params.id, client_id, template_id],
  );
  res.json({ ok: true });
});

router.delete('/:id/otp-clients/:clientId', requirePerm('routes.update'), audit('unmapped_route_otp_client', 'route'), async (req, res) => {
  await getPool().query('DELETE FROM route_otp_clients WHERE route_id=$1 AND client_id=$2', [req.params.id, req.params.clientId]);
  res.json({ ok: true });
});

// ── Membership: add / remove ONE client (member routes) ────────────────────
// POST /routes/:id/members { client_id } → route serves that client too.
// A global route (no members) gains its first member and stops being global.
// DELETE /routes/:id/members/:clientId → client removed; last removal makes
// the route global again, with an exclusion for the removed client. Both idempotent.
router.post('/:id/members', requirePerm('routes.update'), audit('added_route_member', 'route'), async (req, res) => {
  const { client_id } = (req.body ?? {}) as { client_id?: string };
  if (!client_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id)) {
    res.status(400).json({ error: 'provide body.client_id (uuid)' });
    return;
  }
  const route = await queryOne<{ id: string; name: string }>('SELECT id, name FROM routes WHERE id=$1', [req.params.id]);
  if (!route) {
    res.status(404).json({ error: 'route not found' });
    return;
  }
  const client = await queryOne<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id=$1', [client_id]);
  if (!client) {
    res.status(404).json({ error: 'client not found' });
    return;
  }
  const pool = getPool();
  await pool.query('INSERT INTO route_clients (route_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, client_id]);
  // Re-adding a client explicitly also clears any prior global-route exclusion.
  await pool.query(CLEAR_ROUTE_CLIENT_EXCLUSION_SQL, [req.params.id, client_id]);
  const [{ n }] = await query<{ n: string }>('SELECT count(*) AS n FROM route_clients WHERE route_id=$1', [req.params.id]);
  // Keep legacy column in sync: exactly 1 member → set, else NULL.
  const [one] = await query<{ client_id: string }>('SELECT client_id FROM route_clients WHERE route_id=$1 LIMIT 1', [req.params.id]);
  await pool.query('UPDATE routes SET client_id=$1, updated_at=now() WHERE id=$2', [Number(n) === 1 ? one.client_id : null, req.params.id]);
  res.json({ ok: true, member_count: Number(n), added: { client_id, client_name: client.name } });
});

router.delete('/:id/members/:clientId', requirePerm('routes.update'), audit('removed_route_member', 'route'), async (req, res) => {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('DELETE FROM route_clients WHERE route_id=$1 AND client_id=$2', [req.params.id, req.params.clientId]);
    // Membership and its selling rates represent one client/route association.
    // Remove every country/MCC/MNC override so the client cannot reappear in
    // the route's Client Rates panel after access is revoked.
    await db.query(REMOVE_ROUTE_CLIENT_RATES_SQL, [req.params.id, req.params.clientId]);
    const [{ n }] = (await db.query<{ n: string }>('SELECT count(*) AS n FROM route_clients WHERE route_id=$1', [req.params.id])).rows;
    const [one] = (await db.query<{ client_id: string }>('SELECT client_id FROM route_clients WHERE route_id=$1 LIMIT 1', [req.params.id])).rows;
    if (shouldExcludeAfterMemberRemoval(Number(n))) {
      // Last-member removal turns the route global, so retain the explicit
      // removal as an exclusion to avoid immediately re-serving this client.
      await db.query(EXCLUDE_ROUTE_CLIENT_SQL, [req.params.id, req.params.clientId]);
    }
    await db.query('UPDATE routes SET client_id=$1, updated_at=now() WHERE id=$2', [Number(n) === 1 ? one?.client_id ?? null : null, req.params.id]);
    await db.query('COMMIT');
    res.json({ ok: true, member_count: Number(n), became_global: Number(n) === 0 });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
});

// ── Detach a GLOBAL route from ONE client (safe removal) ───────────────────
// Inserts a route_client_exclusions row instead of deleting the route, so the
// route keeps serving everyone else. Member routes use DELETE
// /members/:clientId instead — detach only applies to globals.
// Idempotent: detaching twice is a no-op.
router.post('/:id/detach', requirePerm('routes.update'), audit('detached_route_client', 'route'), async (req, res) => {
  const { client_id } = (req.body ?? {}) as { client_id?: string };
  if (!client_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id)) {
    res.status(400).json({ error: 'provide body.client_id (uuid)' });
    return;
  }
  const route = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM routes WHERE id=$1', [req.params.id],
  );
  if (!route) {
    res.status(404).json({ error: 'route not found' });
    return;
  }
  const [{ n }] = await query<{ n: string }>('SELECT count(*) AS n FROM route_clients WHERE route_id=$1', [req.params.id]);
  if (Number(n) > 0) {
    res.status(422).json({
      error: 'route has explicit members — remove the client via DELETE /routes/:id/members/:clientId instead',
      member_count: Number(n),
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
  const db = await getPool().connect();
  try {
    await db.query('BEGIN');
    await db.query(EXCLUDE_ROUTE_CLIENT_SQL, [req.params.id, client_id]);
    await db.query(REMOVE_ROUTE_CLIENT_RATES_SQL, [req.params.id, client_id]);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
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
    CLEAR_ROUTE_CLIENT_EXCLUSION_SQL, [req.params.id, client_id],
  );
  res.json({ ok: true, reattached: (r.rowCount ?? 0) > 0 });
});

router.delete('/:id', requirePerm('routes.delete'), audit('deleted_route', 'route'), async (req, res) => {
  const route = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM routes WHERE id=$1', [req.params.id],
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
  const [{ n: memberCount }] = await query<{ n: string }>(
    'SELECT count(*) AS n FROM route_clients WHERE route_id=$1', [req.params.id],
  );
  const isGlobal = Number(memberCount) === 0;
  // Guard: deleting a GLOBAL route with recent traffic (or serving many
  // clients) requires explicit ?force=true — the UI surfaces this as a
  // type-to-confirm step with impact stats. Member routes (1..N clients)
  // never served anyone else, so they delete with a single confirm.
  const force = (req.query as Record<string, string>).force === 'true';
  if (isGlobal && !force) {
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
  // route_vendors + traffic_policies + exclusions + members cascade; messages keep route_id history untouched.
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

// ── Production routing: health / logs / rules / failover / test ─────────────

// Vendor weights must total 100 for weighted mode (guard)
function validateWeights(vendors: Array<{ weight: number }>): string | null {
  if (!vendors.length) return null;
  const sum = vendors.reduce((s, v) => s + (v.weight ?? 100), 0);
  if (sum !== 100 && vendors.length > 1) return `vendor weights must total 100 (got ${sum})`;
  return null;
}

// Health: GET /routes/health/all — computed live from routing_logs/messages
router.get('/health/all', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT rh.route_id, r.name AS route_name, r.route_code, rh.vendor_id, v.name AS vendor_name,
              rh.circuit_state, rh.availability_pct, rh.submit_success_pct, rh.dlr_success_pct,
              rh.avg_response_ms, rh.timeout_pct, rh.error_pct, rh.total_sends, rh.consecutive_failures,
              rh.opened_at, rh.recover_at, rh.updated_at
       FROM route_health rh JOIN routes r ON r.id=rh.route_id LEFT JOIN vendors v ON v.id=rh.vendor_id
       ORDER BY rh.updated_at DESC LIMIT 200`,
    );
    res.json({ health: rows });
  } catch { res.json({ health: [] }); }
});
router.get('/:id/health', async (req, res) => {
  try {
    const rows = await query(`SELECT * FROM route_health WHERE route_id=$1 ORDER BY vendor_id`, [req.params.id]);
    res.json({ health: rows });
  } catch { res.json({ health: [] }); }
});
router.post('/:id/health/refresh', requirePerm('routes.update'), audit('refreshed_route_health', 'route'), async (req, res) => {
  const routeId = req.params.id;
  try {
    // recompute from recent routing_logs/messages (last 24h) per vendor
    const stats = await query<{ vendor_id: string; total: string; delivered: string; avg_ms: string }>(
      `SELECT selected_vendor_id AS vendor_id, COUNT(*) AS total,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM messages m WHERE m.id=routing_logs.message_id AND m.status='delivered')) AS delivered,
              COALESCE(AVG(EXTRACT(EPOCH FROM (now() - routing_logs.created_at))*1000)::int, 0) AS avg_ms
       FROM routing_logs WHERE route_id=$1 AND created_at > now() - interval '24 hours' AND selected_vendor_id IS NOT NULL GROUP BY 1`, [routeId],
    );
    for (const s of stats) {
      const total = Number(s.total); const del = Number(s.delivered);
      const succPct = total ? +(del / total * 100).toFixed(2) : null;
      const state: string = succPct != null && succPct < 90 ? 'DEGRADED' : 'HEALTHY';
      await getPool().query(
        `INSERT INTO route_health (route_id, vendor_id, circuit_state, availability_pct, submit_success_pct, dlr_success_pct, avg_response_ms, total_sends, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (route_id, vendor_id) DO UPDATE SET circuit_state=EXCLUDED.circuit_state, availability_pct=EXCLUDED.availability_pct,
           submit_success_pct=EXCLUDED.submit_success_pct, dlr_success_pct=EXCLUDED.dlr_success_pct, avg_response_ms=EXCLUDED.avg_response_ms, total_sends=EXCLUDED.total_sends, updated_at=now()`,
        [routeId, s.vendor_id, state, succPct, succPct, succPct, Number(s.avg_ms), total],
      );
    }
    // auto-open circuit if submit <90% or timeout>5% is handled by periodic refresh; manual trigger here just marks DEGRADED
    res.json({ refreshed: stats.length });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// Routing logs
router.get('/logs/routing', async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: string[] = []; const params: unknown[] = [];
  let i = 1;
  if (q.route_id) { where.push(`l.route_id=$${i++}`); params.push(q.route_id); }
  if (q.client_id) { where.push(`l.client_id=$${i++}`); params.push(q.client_id); }
  if (q.vendor_id) { where.push(`l.selected_vendor_id=$${i++}`); params.push(q.vendor_id); }
  if (q.country_id) { where.push(`l.country_id=$${i++}`); params.push(q.country_id); }
  if (q.from) { where.push(`l.created_at >= $${i++}::timestamptz`); params.push(q.from); }
  if (q.to) { where.push(`l.created_at <= $${i++}::timestamptz`); params.push(q.to); }
  const limit = Math.min(Number(q.limit ?? 100), 500);
  params.push(limit);
  try {
    const rows = await query(`SELECT l.*, r.name AS route_name, c.name AS client_name, co.name AS country_name, v.name AS vendor_name
      FROM routing_logs l LEFT JOIN routes r ON r.id=l.route_id LEFT JOIN clients c ON c.id=l.client_id LEFT JOIN countries co ON co.id=l.country_id LEFT JOIN vendors v ON v.id=l.selected_vendor_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.created_at DESC LIMIT $${i}`, params);
    res.json({ logs: rows });
  } catch { res.json({ logs: [] }); }
});
router.get('/logs/failover', async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: string[] = []; const params: unknown[] = []; let i = 1;
  if (q.route_id) { where.push(`f.route_id=$${i++}`); params.push(q.route_id); }
  if (q.message_id) { where.push(`f.message_id=$${i++}`); params.push(q.message_id); }
  const limit = Math.min(Number(q.limit ?? 100), 500); params.push(limit);
  try {
    const rows = await query(`SELECT f.*, r.name AS route_name FROM failover_logs f LEFT JOIN routes r ON r.id=f.route_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.created_at DESC LIMIT $${i}`, params);
    res.json({ logs: rows });
  } catch { res.json({ logs: [] }); }
});

// Route group members
router.get('/groups/:gid/members', async (req, res) => {
  try {
    const rows = await query(`SELECT m.*, r.name AS route_name, r.route_code FROM route_group_members m JOIN routes r ON r.id=m.route_id WHERE m.group_id=$1 ORDER BY m.priority`, [req.params.gid]);
    res.json({ members: rows });
  } catch { res.json({ members: [] }); }
});
router.post('/groups/:gid/members', requirePerm('routes.create'), audit('added_route_group_member', 'route_group'), async (req, res) => {
  const { route_id, weight, priority } = req.body as { route_id: string; weight?: number; priority?: number };
  if (!route_id) { res.status(400).json({ error: 'route_id required' }); return; }
  try {
    const rows = await query(`INSERT INTO route_group_members (group_id, route_id, weight, priority) VALUES ($1,$2,$3,$4) RETURNING *`, [req.params.gid, route_id, weight ?? 100, priority ?? 1]);
    res.status(201).json({ member: rows[0] });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});
router.delete('/groups/:gid/members/:routeId', requirePerm('routes.delete'), audit('removed_route_group_member', 'route_group'), async (req, res) => {
  await getPool().query(`DELETE FROM route_group_members WHERE group_id=$1 AND route_id=$2`, [req.params.gid, req.params.routeId]);
  res.json({ ok: true });
});

// Failover rules
router.get('/:id/failover', async (req, res) => {
  try {
    const rows = await query(`SELECT fr.*, v.name AS vendor_name, fv.name AS failover_vendor_name FROM failover_rules fr JOIN vendors v ON v.id=fr.vendor_id LEFT JOIN vendors fv ON fv.id=fr.failover_vendor_id WHERE fr.route_id=$1 ORDER BY fr.priority`, [req.params.id]);
    res.json({ rules: rows });
  } catch { res.json({ rules: [] }); }
});
router.post('/:id/failover', requirePerm('routes.create'), audit('created_failover_rule', 'failover_rule'), async (req, res) => {
  const b = req.body as { vendor_id: string; failover_vendor_id?: string; condition?: string; max_attempts?: number; retry_delay_ms?: number; priority?: number };
  if (!b.vendor_id) { res.status(400).json({ error: 'vendor_id required' }); return; }
  try {
    const rows = await query(`INSERT INTO failover_rules (route_id, vendor_id, failover_vendor_id, condition, max_attempts, retry_delay_ms, priority) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, b.vendor_id, b.failover_vendor_id ?? null, b.condition ?? 'any_failure', b.max_attempts ?? 2, b.retry_delay_ms ?? 500, b.priority ?? 1]);
    res.status(201).json({ rule: rows[0] });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});
router.delete('/:id/failover/:ruleId', requirePerm('routes.delete'), audit('deleted_failover_rule', 'failover_rule'), async (req, res) => {
  await getPool().query(`DELETE FROM failover_rules WHERE id=$1 AND route_id=$2`, [req.params.ruleId, req.params.id]);
  res.json({ ok: true });
});

// Routing rules
router.get('/rules/all', async (_req, res) => {
  try {
    const rows = await query(`SELECT rr.*, co.name AS country_name FROM routing_rules rr LEFT JOIN countries co ON co.id=rr.country_id ORDER BY rr.priority, rr.created_at`);
    res.json({ rules: rows });
  } catch { res.json({ rules: [] }); }
});
router.post('/rules', requirePerm('routes.create'), audit('created_routing_rule', 'routing_rule'), async (req, res) => {
  const b = req.body as Record<string, unknown>;
  if (!b.name) { res.status(400).json({ error: 'name required' }); return; }
  try {
    const cols = ['name','route_group_id','route_id','country_id','prefix','mcc','mnc','sender_id','message_type','source_type','source_value','time_from','time_to','traffic_mode','priority','enabled'] as const;
    const vals = cols.map((k) => (b as Record<string, unknown>)[k] ?? null);
    const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(',');
    const rows = await query(`INSERT INTO routing_rules (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`, vals);
    res.status(201).json({ rule: rows[0] });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});
router.patch('/rules/:ruleId', requirePerm('routes.update'), audit('updated_routing_rule', 'routing_rule'), async (req, res) => {
  const allowed = ['name','route_group_id','route_id','country_id','prefix','mcc','mnc','sender_id','message_type','source_type','source_value','time_from','time_to','traffic_mode','priority','enabled'] as const;
  const sets: string[] = []; const params: unknown[] = [];
  for (const k of allowed) if (req.body?.[k] !== undefined) { params.push(req.body[k]); sets.push(`${k}=$${params.length}`); }
  if (!sets.length) { res.status(400).json({ error: 'nothing to update' }); return; }
  params.push(req.params.ruleId);
  try {
    const rows = await query(`UPDATE routing_rules SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params);
    res.json({ rule: rows[0] ?? null });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
});
router.delete('/rules/:ruleId', requirePerm('routes.delete'), audit('deleted_routing_rule', 'routing_rule'), async (req, res) => {
  await getPool().query(`DELETE FROM routing_rules WHERE id=$1`, [req.params.ruleId]);
  res.json({ ok: true });
});

// Test routing — dry-run simulator (§22)
router.post('/:id/test-routing', requirePerm('routes.read'), async (req, res) => {
  const routeId = req.params.id;
  const { destination, source, client_id, text } = req.body as { destination: string; source?: string; client_id?: string; text?: string };
  if (!destination) { res.status(400).json({ error: 'destination required' }); return; }
  try {
    const pool = getPool();
    const countryHit = await pool.query(`SELECT c.id, c.name FROM prefixes p JOIN countries c ON c.id=p.country_id WHERE $1 LIKE p.prefix || '%' ORDER BY length(p.prefix) DESC LIMIT 1`, [String(destination).replace(/\D/g, '')]);
    const country = countryHit.rows[0] ?? null;
    const r = await pool.query(`SELECT * FROM routes WHERE id=$1`, [routeId]);
    if (!r.rows[0]) { res.status(404).json({ error: 'route not found' }); return; }
    const route = r.rows[0] as Record<string, unknown>;
    const vendors = await pool.query(`SELECT rv.priority, rv.weight, v.id AS vendor_id, v.name AS vendor_name, v.status FROM route_vendors rv JOIN vendors v ON v.id=rv.vendor_id WHERE rv.route_id=$1 ORDER BY rv.priority`, [routeId]);
    const chain = (vendors.rows as Array<{ priority: number; weight: number; vendor_id: string; vendor_name: string; status: string }>)
      .filter((v) => v.status === 'enabled').sort((a, b) => a.priority - b.priority);
    const weightNote = validateWeights(chain.map((v) => ({ weight: v.weight })));
    let price: string | null = null;
    if (client_id) {
      const rcr = await pool.query(`SELECT price_per_segment FROM route_client_rates WHERE route_id=$1 AND client_id=$2 AND (country_id IS NULL OR country_id=$3) ORDER BY country_id NULLS LAST LIMIT 1`, [routeId, client_id, country?.id ?? null]).catch(() => ({ rows: [] as never[] }));
      if (rcr.rows[0]?.price_per_segment != null) price = String(rcr.rows[0].price_per_segment);
      else if (route.price_per_segment != null) price = String(route.price_per_segment);
    } else if (route.price_per_segment != null) price = String(route.price_per_segment);
    res.json({
      dry_run: true, route_id: routeId, route_name: route.name, route_code: route.route_code,
      country: country?.name ?? null, destination, source: source ?? null,
      vendors: chain, chain_summary: chain.map((v) => `${v.vendor_name} (p${v.priority} w${v.weight})`).join(' → ') || 'no vendors',
      price_per_segment: price, warnings: weightNote ? [weightNote] : [],
      health_note: 'live health shown in GET /routes/:id/health',
    });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

export function routeRouter(): Router {
  return router;
}

// ── Per-client route rates: Vendor→Route→Client (+ Country/MCC/MNC) override ──
// Priority: route_client_rates (country-specific > generic) → routes.price_per_segment → client_rates.
// Pricing modes: direct | percent_markup | fixed_markup (computed from routes.internal_vendor_cost snapshot).
const rateSchema = z.object({
  client_id: z.string().uuid(),
  price_per_segment: z.number().nonnegative().finite().nullable().optional(),
  currency: z.enum(['EUR', 'USD']).default('EUR'),
  country_id: z.string().uuid().nullable().optional(),
  mcc: z.string().max(5).nullable().optional(),
  mnc: z.string().max(5).nullable().optional(),
  pricing_mode: z.enum(['direct', 'percent_markup', 'fixed_markup']).default('direct'),
  markup_value: z.number().nullable().optional(),
  effective_from: z.string().datetime({ offset: true }).nullable().optional(),
});

router.get('/:id/client-rates', async (req, res) => {
  const rows = await query(
    `SELECT rcr.*, c.name AS client_name, c.system_id, co.name AS country_name, co.iso_code
     FROM route_client_rates rcr
     JOIN clients c ON c.id=rcr.client_id
     LEFT JOIN countries co ON co.id=rcr.country_id
     WHERE rcr.route_id=$1 ORDER BY c.name, co.name NULLS LAST, rcr.effective_from DESC`,
    [req.params.id],
  );
  // Enrich with margin vs internal cost for admin view
  const route = await queryOne<{ internal_vendor_cost: string | null }>('SELECT internal_vendor_cost FROM routes WHERE id=$1', [req.params.id]);
  const cost = route?.internal_vendor_cost != null ? Number(route.internal_vendor_cost) : null;
  res.json({ rates: (rows as Record<string, unknown>[]).map((r) => {
    const selling = r.price_per_segment != null ? Number(r.price_per_segment) : null;
    const margin = selling != null && cost != null ? +(selling - cost).toFixed(6) : null;
    const marginPct = selling != null && cost != null && cost !== 0 ? +((selling - cost) / cost * 100).toFixed(2) : null;
    return { ...r, margin, margin_pct: marginPct, vendor_cost_snapshot: cost };
  }) });
});

router.post('/:id/client-rates', requirePerm('routes.create'), audit('set_client_route_rate', 'route_client_rate'), async (req, res) => {
  const route = await queryOne<{ internal_vendor_cost: string | null; internal_cost_currency: string | null }>(
    'SELECT internal_vendor_cost, internal_cost_currency FROM routes WHERE id=$1', [req.params.id],
  );
  if (!route) { res.status(404).json({ error: 'route not found' }); return; }
  const parsed = rateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  const b = parsed.data;
  const client = await queryOne('SELECT id FROM clients WHERE id=$1', [b.client_id]);
  if (!client) { res.status(404).json({ error: 'client not found' }); return; }
  // Resolve price: direct vs markup modes
  let price = b.price_per_segment as number | null | undefined;
  let vendorSnapshot: number | null = route.internal_vendor_cost != null ? Number(route.internal_vendor_cost) : null;
  if (b.pricing_mode !== 'direct') {
    if (vendorSnapshot == null) { res.status(422).json({ error: 'internal vendor cost not set on route — set it before using markup modes' }); return; }
    if (b.markup_value == null) { res.status(400).json({ error: 'markup_value required for percent/fixed markup' }); return; }
    const m = Number(b.markup_value);
    price = b.pricing_mode === 'percent_markup' ? vendorSnapshot * (1 + m / 100) : vendorSnapshot + m;
    price = +price.toFixed(6);
  }
  if (price == null || !Number.isFinite(price) || price < 0) { res.status(400).json({ error: 'price_per_segment must be ≥ 0' }); return; }
  if (b.country_id) {
    const co = await queryOne('SELECT id FROM countries WHERE id=$1', [b.country_id]);
    if (!co) { res.status(404).json({ error: 'country not found' }); return; }
  }
  const actor = (req as unknown as { user?: { id?: string } }).user?.id ?? null;
  try {
    const { rows } = await getPool().query(
      `INSERT INTO route_client_rates (route_id, client_id, country_id, mcc, mnc, price_per_segment, currency, pricing_mode, markup_value, vendor_cost_snapshot, effective_from, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, now()), $12) RETURNING *`,
      [req.params.id, b.client_id, b.country_id ?? null, b.mcc ?? null, b.mnc ?? null, price, b.currency, b.pricing_mode, b.markup_value ?? null, vendorSnapshot, b.effective_from ?? null, actor],
    );
    await getPool().query(
      `INSERT INTO route_rate_history (route_id, client_id, country_id, mcc, mnc, previous_rate, new_rate, currency, pricing_mode, markup_value, changed_by, notification_status)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,'not_sent')`,
      [req.params.id, b.client_id, b.country_id ?? null, b.mcc ?? null, b.mnc ?? null, price, b.currency, b.pricing_mode, b.markup_value ?? null, actor],
    ).catch(() => undefined);
    res.status(201).json({ rate: rows[0] });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') { res.status(409).json({ error: 'rate already exists for this route+client+country — use PATCH or bulk edit' }); return; }
    throw e;
  }
});

router.post('/:id/client-rates/bulk', requirePerm('routes.update'), audit('bulk_set_client_route_rates', 'route_client_rate'), async (req, res) => {
  const route = await queryOne<{ internal_vendor_cost: string | null }>('SELECT internal_vendor_cost FROM routes WHERE id=$1', [req.params.id]);
  if (!route) { res.status(404).json({ error: 'route not found' }); return; }
  const parsed = z.object({
    client_ids: z.array(z.string().uuid()).min(1).max(100),
    country_ids: z.array(z.string().uuid()).nullable().optional(), // null/empty = apply to all (existing rows) or generic
    price_per_segment: z.number().nonnegative().finite().nullable().optional(),
    pricing_mode: z.enum(['direct', 'percent_markup', 'fixed_markup']).default('direct'),
    markup_value: z.number().nullable().optional(),
    currency: z.enum(['EUR', 'USD']).default('EUR'),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  const b = parsed.data;
  let priceDirect = b.price_per_segment;
  if (b.pricing_mode !== 'direct') {
    const cost = route.internal_vendor_cost != null ? Number(route.internal_vendor_cost) : null;
    if (cost == null) { res.status(422).json({ error: 'set internal vendor cost on route before using markup' }); return; }
    if (b.markup_value == null) { res.status(400).json({ error: 'markup_value required' }); return; }
    const m = Number(b.markup_value);
    priceDirect = b.pricing_mode === 'percent_markup' ? +(cost * (1 + m / 100)).toFixed(6) : +(cost + m).toFixed(6);
  }
  if (priceDirect == null) { res.status(400).json({ error: 'price_per_segment required for direct mode' }); return; }
  const actor = (req as unknown as { user?: { id?: string } }).user?.id ?? null;
  const snapshot = route.internal_vendor_cost != null ? Number(route.internal_vendor_cost) : null;
  let upserted = 0;
  for (const cid of b.client_ids) {
    const targets: (string | null)[] = b.country_ids?.length ? b.country_ids : [null];
    for (const coid of targets) {
      const prev = await queryOne<{ price_per_segment: string }>(
        'SELECT price_per_segment FROM route_client_rates WHERE route_id=$1 AND client_id=$2 AND COALESCE(country_id,$3)=COALESCE($4,$3)', [req.params.id, cid, '00000000-0000-0000-0000-000000000000', coid],
      ).catch(() => null);
      await getPool().query(
        `INSERT INTO route_client_rates (route_id, client_id, country_id, price_per_segment, currency, pricing_mode, markup_value, vendor_cost_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (route_id, client_id, COALESCE(country_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(mcc,''), COALESCE(mnc,''))
         DO UPDATE SET price_per_segment=EXCLUDED.price_per_segment, currency=EXCLUDED.currency, pricing_mode=EXCLUDED.pricing_mode, markup_value=EXCLUDED.markup_value, vendor_cost_snapshot=EXCLUDED.vendor_cost_snapshot, updated_at=now()`,
        [req.params.id, cid, coid, priceDirect, b.currency, b.pricing_mode, b.markup_value ?? null, snapshot, actor],
      );
      await getPool().query(
        `INSERT INTO route_rate_history (route_id, client_id, country_id, previous_rate, new_rate, currency, pricing_mode, markup_value, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.params.id, cid, coid, prev?.price_per_segment ? Number(prev.price_per_segment) : null, priceDirect, b.currency, b.pricing_mode, b.markup_value ?? null, actor],
      ).catch(() => undefined);
      upserted++;
    }
  }
  res.json({ upserted });
});

router.post('/:id/client-rates/copy', requirePerm('routes.update'), audit('copied_client_route_rates', 'route_client_rate'), async (req, res) => {
  const parsed = z.object({
    from_client_id: z.string().uuid(),
    to_client_ids: z.array(z.string().uuid()).min(1).max(50),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  const src = await query(`SELECT * FROM route_client_rates WHERE route_id=$1 AND client_id=$2`, [req.params.id, parsed.data.from_client_id]);
  if (!src.length) { res.status(404).json({ error: 'source client has no rates on this route' }); return; }
  const actor = (req as unknown as { user?: { id?: string } }).user?.id ?? null;
  let copied = 0;
  for (const toId of parsed.data.to_client_ids) {
    for (const r of src as Array<Record<string, unknown>>) {
      await getPool().query(
        `INSERT INTO route_client_rates (route_id, client_id, country_id, mcc, mnc, price_per_segment, currency, pricing_mode, markup_value, vendor_cost_snapshot, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (route_id, client_id, COALESCE(country_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(mcc,''), COALESCE(mnc,''))
         DO UPDATE SET price_per_segment=EXCLUDED.price_per_segment, currency=EXCLUDED.currency, updated_at=now()`,
        [req.params.id, toId, r.country_id ?? null, r.mcc ?? null, r.mnc ?? null, r.price_per_segment, r.currency, r.pricing_mode ?? 'direct', r.markup_value ?? null, r.vendor_cost_snapshot ?? null, actor],
      );
      copied++;
    }
  }
  res.json({ copied, source_rates: src.length, targets: parsed.data.to_client_ids.length });
});

// ── Excel import: preview (validate, no write) + apply ─────────────────
router.post('/:id/client-rates/import-preview', requirePerm('routes.update'), async (req, res) => {
  const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows) || !rows.length) { res.status(400).json({ error: 'body.rows[] required (from Excel parse)' }); return; }
  if (rows.length > 2000) { res.status(400).json({ error: 'max 2000 rows per import' }); return; }
  const errors: Array<{ row: number; error: string }> = [];
  const preview: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    const country = String(r.country ?? r.Country ?? '').trim();
    const mcc = r.mcc != null ? String(r.mcc).trim() : null;
    const mnc = r.mnc != null ? String(r.mnc).trim() : null;
    const rate = Number(r.rate ?? r.price ?? r.Rate ?? '');
    const currency = String(r.currency ?? r.Currency ?? 'EUR').toUpperCase();
    const clientId = String(r.client_id ?? r.clientId ?? req.body?.client_id ?? '').trim();
    if (!country && !mcc) errors.push({ row: i + 1, error: 'country or MCC required' });
    if (!Number.isFinite(rate) || rate < 0) errors.push({ row: i + 1, error: 'rate must be ≥ 0' });
    if (!['EUR', 'USD'].includes(currency)) errors.push({ row: i + 1, error: 'currency must be EUR or USD' });
    if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) errors.push({ row: i + 1, error: 'invalid client_id' });
    preview.push({ row: i + 1, country: country || null, mcc, mnc, rate: Number.isFinite(rate) ? rate : null, currency, client_id: clientId || null, valid: errors.every((e) => e.row !== i + 1) });
  }
  res.json({ total: rows.length, valid: preview.filter((p) => p.valid).length, invalid: errors.length, errors: errors.slice(0, 50), preview: preview.slice(0, 100) });
});

router.post('/:id/client-rates/import-apply', requirePerm('routes.update'), audit('imported_client_route_rates', 'route_client_rate'), async (req, res) => {
  const rows = (req.body?.rows ?? []) as Array<Record<string, unknown>>;
  const defaultClientId = req.body?.client_id as string | undefined;
  if (!Array.isArray(rows) || !rows.length) { res.status(400).json({ error: 'body.rows[] required' }); return; }
  const actor = (req as unknown as { user?: { id?: string } }).user?.id ?? null;
  let applied = 0; const errs: string[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const cid = String(r.client_id ?? r.clientId ?? defaultClientId ?? '').trim();
    if (!cid) { errs.push('missing client_id'); continue; }
    const rate = Number(r.rate ?? r.price ?? '');
    const currency = String(r.currency ?? 'EUR').toUpperCase();
    if (!Number.isFinite(rate) || rate < 0) { errs.push(`invalid rate for ${cid}`); continue; }
    const countryName = String(r.country ?? '').trim();
    let countryId: string | null = null;
    if (countryName) {
      const co = await queryOne<{ id: string }>('SELECT id FROM countries WHERE lower(name)=lower($1) OR lower(iso_code)=lower($1) LIMIT 1', [countryName]).catch(() => null);
      countryId = co?.id ?? null;
    }
    try {
      await getPool().query(
        `INSERT INTO route_client_rates (route_id, client_id, country_id, mcc, mnc, price_per_segment, currency, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (route_id, client_id, COALESCE(country_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(mcc,''), COALESCE(mnc,''))
         DO UPDATE SET price_per_segment=EXCLUDED.price_per_segment, currency=EXCLUDED.currency, updated_at=now()`,
        [req.params.id, cid, countryId, r.mcc ? String(r.mcc) : null, r.mnc ? String(r.mnc) : null, rate, ['EUR', 'USD'].includes(currency) ? currency : 'EUR', actor],
      );
      applied++;
    } catch (e) { errs.push((e as Error).message.slice(0, 120)); }
  }
  res.json({ applied, errors: errs.slice(0, 20) });
});

router.patch('/:id/client-rates/:rateId', requirePerm('routes.update'), audit('updated_client_route_rate', 'route_client_rate'), async (req, res) => {
  const sets: string[] = []; const params: unknown[] = [];
  let newPrice: number | null = null;
  let pricingMode: string | null = null;
  let markupVal: number | null = null;
  if (req.body?.pricing_mode !== undefined) { pricingMode = String(req.body.pricing_mode); if (!['direct', 'percent_markup', 'fixed_markup'].includes(pricingMode)) { res.status(400).json({ error: 'invalid pricing_mode' }); return; } }
  if (req.body?.price_per_segment !== undefined) {
    const n = Number(req.body.price_per_segment);
    if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: 'price_per_segment must be ≥ 0' }); return; }
    newPrice = n;
  }
  if (req.body?.markup_value !== undefined) markupVal = req.body.markup_value != null ? Number(req.body.markup_value) : null;
  // If markup mode, recompute price from current vendor cost
  if (pricingMode && pricingMode !== 'direct') {
    const route = await queryOne<{ internal_vendor_cost: string | null }>('SELECT internal_vendor_cost FROM routes WHERE id=$1', [req.params.id]);
    const cost = route?.internal_vendor_cost != null ? Number(route.internal_vendor_cost) : null;
    if (cost == null) { res.status(422).json({ error: 'set internal vendor cost first' }); return; }
    if (markupVal == null) { res.status(400).json({ error: 'markup_value required' }); return; }
    newPrice = pricingMode === 'percent_markup' ? +(cost * (1 + markupVal / 100)).toFixed(6) : +(cost + markupVal).toFixed(6);
  }
  if (newPrice != null) { params.push(newPrice); sets.push(`price_per_segment = $${params.length}`); }
  if (pricingMode) { params.push(pricingMode); sets.push(`pricing_mode = $${params.length}`); }
  if (req.body?.markup_value !== undefined) { params.push(markupVal); sets.push(`markup_value = $${params.length}`); }
  if (req.body?.currency !== undefined) {
    const c = String(req.body.currency).toUpperCase();
    if (!['EUR', 'USD'].includes(c)) { res.status(400).json({ error: 'currency must be EUR or USD' }); return; }
    params.push(c); sets.push(`currency = $${params.length}`);
  }
  if (req.body?.country_id !== undefined) { params.push(req.body.country_id || null); sets.push(`country_id = $${params.length}`); }
  if (req.body?.mcc !== undefined) { params.push(req.body.mcc || null); sets.push(`mcc = $${params.length}`); }
  if (req.body?.mnc !== undefined) { params.push(req.body.mnc || null); sets.push(`mnc = $${params.length}`); }
  if (req.body?.effective_from !== undefined) {
    params.push(req.body.effective_from ? new Date(req.body.effective_from) : null);
    sets.push(`effective_from = COALESCE($${params.length}, effective_from)`);
  }
  if (!sets.length) { res.status(400).json({ error: 'nothing to update' }); return; }
  const prev = await queryOne<{ price_per_segment: string; currency: string }>('SELECT price_per_segment, currency FROM route_client_rates WHERE id=$1 AND route_id=$2', [req.params.rateId, req.params.id]);
  params.push(req.params.rateId); params.push(req.params.id);
  const rows = await query(
    `UPDATE route_client_rates SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND route_id=$${params.length} RETURNING *`, params,
  );
  if (!rows.length) { res.status(404).json({ error: 'not found' }); return; }
  if (newPrice != null && prev) {
    await getPool().query(
      `INSERT INTO route_rate_history (route_id, client_id, country_id, previous_rate, new_rate, currency, changed_by)
       SELECT $1, client_id, country_id, $2, $3, $4, $5 FROM route_client_rates WHERE id=$6`,
      [req.params.id, Number(prev.price_per_segment), newPrice, (rows[0] as Record<string, unknown>).currency ?? prev.currency, (req as unknown as { user?: { id?: string } }).user?.id ?? null, req.params.rateId],
    ).catch(() => undefined);
  }
  res.json({ rate: rows[0] });
});

router.delete('/:id/client-rates/:rateId', requirePerm('routes.delete'), audit('deleted_client_route_rate', 'route_client_rate'), async (req, res) => {
  const r = await getPool().query('DELETE FROM route_client_rates WHERE id=$1 AND route_id=$2', [req.params.rateId, req.params.id]);
  if (!r.rowCount) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ ok: true });
});

// ── Rate history ────────────────────────────────────────────────────────
router.get('/:id/rate-history', async (req, res) => {
  const rows = await query(
    `SELECT h.*, c.name AS client_name, c.system_id, co.name AS country_name,
            u.email AS changed_by_email
     FROM route_rate_history h
     JOIN clients c ON c.id=h.client_id
     LEFT JOIN countries co ON co.id=h.country_id
     LEFT JOIN users u ON u.id=h.changed_by
     WHERE h.route_id=$1 ORDER BY h.changed_at DESC LIMIT 200`,
    [req.params.id],
  );
  res.json({ history: rows });
});

// ── Profitability & portal moved to literal-before-:id section above ───────

export default router;
