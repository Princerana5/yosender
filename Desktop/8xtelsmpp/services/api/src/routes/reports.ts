import { Router } from 'express';
import { query } from '@8xtel/core';
import { getDayStats } from '@8xtel/core';
import { requirePerm } from '../middleware.js';

const router = Router();
router.use(requirePerm('reports.read'));

// ── Dashboard aggregate (§3) ────────────────────────────────────────────────
router.get('/dashboard', async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const [counts] = await query<{
    today: string; month: string; submitted: string; delivered: string;
    undelivered: string; expired: string; rejected: string; failed: string;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE created_at::date = $1::date) AS today,
      COUNT(*) FILTER (WHERE to_char(created_at,'YYYY-MM') = $2) AS month,
      COUNT(*) FILTER (WHERE status='submitted') AS submitted,
      COUNT(*) FILTER (WHERE status='delivered') AS delivered,
      COUNT(*) FILTER (WHERE status='undelivered') AS undelivered,
      COUNT(*) FILTER (WHERE status='expired') AS expired,
      COUNT(*) FILTER (WHERE status='rejected') AS rejected,
      COUNT(*) FILTER (WHERE status='failed') AS failed
    FROM messages WHERE created_at >= date_trunc('month', now()) - interval '1 day'`, [today, month]);

  const [money] = await query<{ revenue: string; cost: string; profit: string }>(`
    SELECT COALESCE(SUM(client_price),0) AS revenue, COALESCE(SUM(vendor_cost),0) AS cost,
           COALESCE(SUM(profit),0) AS profit FROM billing_records
    WHERE created_at::date = $1::date`, [today]);

  const [entities] = await query<{ clients: string; vendors: string; conns: string }>(`
    SELECT (SELECT COUNT(*) FROM clients WHERE status='active') AS clients,
           (SELECT COUNT(*) FROM vendors WHERE status='enabled') AS vendors,
           (SELECT COUNT(*) FROM vendor_connections WHERE status='connected') AS conns`);

  const stats = await getDayStats(today).catch(() => ({}));
  const delivered = Number(counts.delivered);
  const total = delivered + Number(counts.undelivered) + Number(counts.expired) + Number(counts.rejected) + Number(counts.failed);

  res.json({
    today: Number(counts.today),
    month: Number(counts.month),
    submitted: Number(counts.submitted),
    delivered,
    undelivered: Number(counts.undelivered),
    expired: Number(counts.expired),
    rejected: Number(counts.rejected),
    failed: Number(counts.failed),
    delivery_pct: total ? +(delivered / total * 100).toFixed(2) : 100,
    active_clients: Number(entities.clients),
    active_vendors: Number(entities.vendors),
    active_connections: Number(entities.conns),
    revenue: Number(money.revenue),
    cost: Number(money.cost),
    profit: Number(money.profit),
    realtime: stats,
  });
});

// ── Hourly traffic (last 24h) ───────────────────────────────────────────────
router.get('/traffic/hourly', async (_req, res) => {
  const rows = await query(
    `SELECT date_trunc('hour', created_at) AS hour, COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status='delivered') AS delivered
     FROM messages WHERE created_at >= now() - interval '24 hours'
     GROUP BY 1 ORDER BY 1`,
  );
  res.json({ hourly: rows });
});

// ── Financials (§29) ────────────────────────────────────────────────────────
router.get('/financial', async (req, res) => {
  const q = req.query as Record<string, string>;
  const groupBy = q.by === 'client' ? 'client_id' : q.by === 'vendor' ? 'vendor_id' : 'day';
  const rows = groupBy === 'day'
    ? await query(
      `SELECT created_at::date AS day, SUM(client_price) AS revenue, SUM(vendor_cost) AS cost, SUM(profit) AS profit
       FROM billing_records WHERE created_at >= COALESCE($1::date, now() - interval '30 days')
       GROUP BY 1 ORDER BY 1`, [q.from ?? null],
    )
    : await query(
      `SELECT ${groupBy} AS id, SUM(client_price) AS revenue, SUM(vendor_cost) AS cost, SUM(profit) AS profit, COUNT(*) AS messages
       FROM billing_records WHERE created_at >= COALESCE($1::date, now() - interval '30 days')
       GROUP BY 1 ORDER BY profit DESC`, [q.from ?? null],
    );
  res.json({ financial: rows });
});

// ── Live traffic: per-client × country × vendor (last N minutes) ────────────
router.get('/live', async (req, res) => {
  const q = req.query as Record<string, string>;
  const minutes = Math.min(Math.max(Number(q.minutes ?? 15), 1), 1440);
  const clientId = q.client_id || null;
  const countryId = q.country_id || null;
  const vendorId = q.vendor_id || null;

  const flow = await query(
    `SELECT m.client_id, c.name AS client_name, c.system_id,
            m.country_id, co.name AS country_name, co.iso_code,
            m.vendor_id, v.name AS vendor_name,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE m.status='delivered') AS delivered,
            COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered','expired','rejected')) AS failed,
            COUNT(*) FILTER (WHERE m.status='submitted') AS pending,
            MAX(m.created_at) AS last_at
     FROM messages m
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     WHERE m.created_at >= now() - ($1 || ' minutes')::interval
       AND ($2::uuid IS NULL OR m.client_id=$2::uuid)
       AND ($3::uuid IS NULL OR m.country_id=$3::uuid)
       AND ($4::uuid IS NULL OR m.vendor_id=$4::uuid)
     GROUP BY 1,2,3,4,5,6,7,8
     ORDER BY total DESC LIMIT 100`,
    [String(minutes), clientId, countryId, vendorId],
  );

  const recent = await query(
    `SELECT m.id, m.created_at, m.source, m.destination, m.status,
            c.name AS client_name, co.name AS country_name, co.iso_code,
            v.name AS vendor_name, r.name AS route_name
     FROM messages m
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN routes r ON r.id=m.route_id
     WHERE ($1::uuid IS NULL OR m.client_id=$1::uuid)
       AND ($2::uuid IS NULL OR m.country_id=$2::uuid)
       AND ($3::uuid IS NULL OR m.vendor_id=$3::uuid)
     ORDER BY m.created_at DESC LIMIT 50`,
    [clientId, countryId, vendorId],
  );

  const [tps] = await query<{ per_min: string }>(
    `SELECT COUNT(*) AS per_min FROM messages
     WHERE created_at >= now() - interval '1 minute'
       AND ($1::uuid IS NULL OR client_id=$1::uuid)`,
    [clientId],
  );

  res.json({
    window_minutes: minutes,
    msgs_per_min: Number(tps.per_min),
    flow,
    recent,
  });
});

// ── Delivery by country / vendor ────────────────────────────────────────────
router.get('/delivery', async (_req, res) => {
  const byCountry = await query(
    `SELECT co.name AS country, co.iso_code, COUNT(*) AS total,
            COUNT(*) FILTER (WHERE m.status='delivered') AS delivered
     FROM messages m LEFT JOIN countries co ON co.id=m.country_id
     WHERE m.created_at >= now() - interval '7 days' GROUP BY 1,2 ORDER BY total DESC LIMIT 50`,
  );
  const byVendor = await query(
    `SELECT v.name AS vendor, COUNT(*) AS total,
            COUNT(*) FILTER (WHERE m.status='delivered') AS delivered
     FROM messages m LEFT JOIN vendors v ON v.id=m.vendor_id
     WHERE m.created_at >= now() - interval '7 days' GROUP BY 1 ORDER BY total DESC`,
  );
  res.json({ by_country: byCountry, by_vendor: byVendor });
});

export default router;
