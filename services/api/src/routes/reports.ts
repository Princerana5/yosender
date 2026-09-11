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
