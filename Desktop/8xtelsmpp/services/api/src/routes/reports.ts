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

// ── Live traffic: per-client × country × vendor ───────────────────────────────
// Window: rolling last-N-minutes (?minutes=, cap 7 days) or a calendar day
// (?day=yesterday = previous calendar day 00:00–24:00, server timezone).
router.get('/live', async (req, res) => {
  const q = req.query as Record<string, string>;
  const clientId = q.client_id || null;
  const countryId = q.country_id || null;
  const vendorId = q.vendor_id || null;

  // Param slots are built dynamically so the calendar-day branch (no $1
  // minutes param) keeps numbering correct.
  const params: unknown[] = [];
  const push = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  let timeFilter: string;
  let windowLabel: string;
  let windowMinutes: number | null;
  if (q.day === 'yesterday') {
    timeFilter = `m.created_at >= (CURRENT_DATE - interval '1 day') AND m.created_at < CURRENT_DATE`;
    windowLabel = 'yesterday';
    windowMinutes = null;
  } else {
    const minutes = Math.min(Math.max(Number(q.minutes ?? 15), 1), 10080);
    const mSlot = push(String(minutes));
    timeFilter = `m.created_at >= now() - (${mSlot} || ' minutes')::interval`;
    windowLabel = `last_${minutes}m`;
    windowMinutes = minutes;
  }
  const cSlot = push(clientId);
  const coSlot = push(countryId);
  const vSlot = push(vendorId);

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
     WHERE ${timeFilter}
       AND (${cSlot}::uuid IS NULL OR m.client_id=${cSlot}::uuid)
       AND (${coSlot}::uuid IS NULL OR m.country_id=${coSlot}::uuid)
       AND (${vSlot}::uuid IS NULL OR m.vendor_id=${vSlot}::uuid)
     GROUP BY 1,2,3,4,5,6,7,8
     ORDER BY total DESC LIMIT 100`,
    params,
  );

  const recent = await query(
    `SELECT m.id, m.created_at, m.source, m.destination, m.status, m.text,
            c.name AS client_name, co.name AS country_name, co.iso_code,
            v.name AS vendor_name, r.name AS route_name
     FROM messages m
     LEFT JOIN clients c ON c.id=m.client_id
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN routes r ON r.id=m.route_id
     WHERE ${timeFilter}
       AND (${cSlot}::uuid IS NULL OR m.client_id=${cSlot}::uuid)
       AND (${coSlot}::uuid IS NULL OR m.country_id=${coSlot}::uuid)
       AND (${vSlot}::uuid IS NULL OR m.vendor_id=${vSlot}::uuid)
     ORDER BY m.created_at DESC LIMIT 50`,
    params,
  );

  const [tps] = await query<{ per_min: string }>(
    `SELECT COUNT(*) AS per_min FROM messages
     WHERE created_at >= now() - interval '1 minute'
       AND ($1::uuid IS NULL OR client_id=$1::uuid)`,
    [clientId],
  );

  res.json({
    window: windowLabel,
    window_minutes: windowMinutes,
    msgs_per_min: Number(tps.per_min),
    flow,
    recent,
  });
});

// ── Client traffic export (CSV, opens in Excel) ─────────────────────────────
// GET /reports/client-export?client_id=<uuid>&range=today|yesterday|last30
// Max window 30 days. Streams CSV so large exports don't blow memory.
router.get('/client-export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const clientId = q.client_id;
  if (!clientId) {
    res.status(400).json({ error: 'client_id is required' });
    return;
  }
  const range = q.range ?? 'today';
  let from: string;
  let to: string;
  let label: string;
  if (range === 'yesterday') {
    from = `CURRENT_DATE - interval '1 day'`;
    to = `CURRENT_DATE`;
    label = 'yesterday';
  } else if (range === 'last30') {
    from = `now() - interval '30 days'`;
    to = `now()`;
    label = 'last30days';
  } else {
    from = `CURRENT_DATE`;
    to = `CURRENT_DATE + interval '1 day'`;
    label = 'today';
  }
  const client = await query<{ name: string }>(
    'SELECT name FROM clients WHERE id=$1::uuid', [clientId],
  ).then((r) => r[0]).catch(() => undefined);
  if (!client) {
    res.status(404).json({ error: 'client not found' });
    return;
  }
  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fname = `traffic-${client.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${label}.csv`;
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${fname}"`);
  res.write('Date,Time,From,To,Country,Vendor,Route,Status,Segments,Cost\n');
  // Paginated fetch (5k rows/page, hard cap 200k) so big exports stream
  // without loading everything into memory at once.
  const PAGE = 5000;
  const CAP = 200000;
  let offset = 0;
  try {
    for (;;) {
      const rows = await query<Record<string, unknown>>(
        `SELECT m.created_at, m.source, m.destination,
                co.name AS country, v.name AS vendor, r.name AS route,
                m.status, m.segments, m.client_price
         FROM messages m
         LEFT JOIN countries co ON co.id=m.country_id
         LEFT JOIN vendors v ON v.id=m.vendor_id
         LEFT JOIN routes r ON r.id=m.route_id
         WHERE m.client_id=$1::uuid AND m.created_at >= ${from} AND m.created_at < ${to}
         ORDER BY m.created_at DESC LIMIT ${PAGE} OFFSET ${offset}`,
        [clientId],
      );
      for (const row of rows) {
        const d = new Date(String(row.created_at));
        res.write([
          d.toISOString().slice(0, 10), d.toISOString().slice(11, 19),
          esc(row.source), esc(row.destination), esc(row.country),
          esc(row.vendor), esc(row.route), esc(row.status),
          String(row.segments ?? 1), String(row.client_price ?? 0),
        ].join(',') + '\n');
      }
      offset += rows.length;
      if (rows.length < PAGE || offset >= CAP) break;
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: `export failed: ${(e as Error).message}` });
    return;
  }
  res.end();
});

// ── Client traffic report (§10 — per-client summary, daily credit usage, detail)
// All figures come from actual records: messages (traffic), billing_records
// (settled per-message charge), transactions (money ledger), credit_transactions
// (credit ledger). Never derived from the current balance.
function reportRange(q: Record<string, string>): { from: string; to: string; label: string } {
  const preset = q.preset ?? '';
  const now = new Date();
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  if (q.from || q.to) {
    const from = q.from || '1970-01-01';
    const to = q.to || iso(now);
    return { from, to, label: `${from}_to_${to}` };
  }
  const startOfMonth = `${iso(now).slice(0, 7)}-01`;
  if (preset === 'yesterday') {
    const y = new Date(now.getTime() - 86400000);
    return { from: iso(y), to: iso(y), label: 'yesterday' };
  }
  if (preset === 'last7') {
    return { from: iso(new Date(now.getTime() - 6 * 86400000)), to: iso(now), label: 'last7days' };
  }
  if (preset === 'last30') {
    return { from: iso(new Date(now.getTime() - 29 * 86400000)), to: iso(now), label: 'last30days' };
  }
  if (preset === 'month') {
    return { from: startOfMonth, to: iso(now), label: 'month-to-date' };
  }
  return { from: iso(now), to: iso(now), label: 'today' };
}

// GET /reports/client/:id/summary?preset=today|yesterday|last7|last30|month&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/client/:id/summary', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { from, to, label } = reportRange(q);
  const clientId = req.params.id;
  const client = await query(
    `SELECT c.id, c.name, c.company_name, c.system_id, c.portal_email, c.status,
            c.currency, c.billing_mode, c.tps_limit, c.created_at,
            COALESCE(w.balance,0) AS balance, COALESCE(w.sms_credits,0) AS sms_credits,
            COALESCE(w.credit_limit,0) AS credit_limit
     FROM clients c LEFT JOIN wallets w ON w.client_id=c.id WHERE c.id=$1::uuid`,
    [clientId],
  ).then((r) => r[0]).catch(() => undefined);
  if (!client) {
    res.status(404).json({ error: 'client not found' });
    return;
  }
  const [mix] = await query<{
    total: string; ok: string; fail: string; pending: string;
    charged: string; credits: string; segments: string;
  }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE m.status='delivered') AS ok,
            COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered','expired','rejected')) AS fail,
            COUNT(*) FILTER (WHERE m.status='submitted') AS pending,
            COALESCE(SUM(b.client_price),0) AS charged,
            COALESCE(SUM(COALESCE(m.credits_charged, m.reserved_credits, 0)),0) AS credits,
            COALESCE(SUM(COALESCE(m.segments,1)),0) AS segments
     FROM messages m LEFT JOIN billing_records b ON b.message_id=m.id
     WHERE m.client_id=$1::uuid AND m.created_at >= $2::date
       AND m.created_at < ($3::date + interval '1 day')`,
    [clientId, from, to],
  );
  const days = Math.max(1, Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
  );
  res.json({
    client, range: { from, to, label, days },
    summary: {
      total: Number(mix.total), delivered: Number(mix.ok), failed: Number(mix.fail),
      pending: Number(mix.pending),
      credit_used: Number(mix.charged), credits_used: Number(mix.credits),
      segments: Number(mix.segments),
      avg_daily: +(Number(mix.total) / days).toFixed(1),
      avg_daily_credit: +(Number(mix.charged) / days).toFixed(4),
    },
  });
});

// GET /reports/client/:id/daily?... — date-wise traffic + credit used (from records)
router.get('/client/:id/daily', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { from, to, label } = reportRange(q);
  const clientId = req.params.id;
  const rows = await query(
    `SELECT m.created_at::date AS day, COUNT(*) AS total,
            COUNT(*) FILTER (WHERE m.status='delivered') AS delivered,
            COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered','expired','rejected')) AS failed,
            COALESCE(SUM(b.client_price),0) AS credit_used,
            COALESCE(SUM(COALESCE(m.credits_charged, m.reserved_credits, 0)),0) AS credits_used,
            COALESCE(SUM(COALESCE(m.segments,1)),0) AS segments
     FROM messages m LEFT JOIN billing_records b ON b.message_id=m.id
     WHERE m.client_id=$1::uuid AND m.created_at >= $2::date
       AND m.created_at < ($3::date + interval '1 day')
     GROUP BY 1 ORDER BY 1`,
    [clientId, from, to],
  );
  res.json({ range: { from, to, label }, daily: rows });
});

// GET /reports/client/:id/messages?...&status=&destination=&sender=&limit=&offset=
router.get('/client/:id/messages', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { from, to, label } = reportRange(q);
  const clientId = req.params.id;
  const params: unknown[] = [clientId, from, to];
  let extra = '';
  if (q.status) {
    params.push(q.status);
    extra += ` AND m.status=$${params.length}`;
  }
  if (q.destination) {
    params.push(`%${q.destination}%`);
    extra += ` AND m.destination LIKE $${params.length}`;
  }
  if (q.sender) {
    params.push(`%${q.sender}%`);
    extra += ` AND m.source ILIKE $${params.length}`;
  }
  const limit = Math.min(Number(q.limit ?? 50), 500);
  const offset = Math.max(0, Number(q.offset ?? 0));
  params.push(limit, offset);
  const rows = await query(
    `SELECT m.id, m.created_at, m.source, m.destination, m.status, m.text,
            co.name AS country_name, co.iso_code, v.name AS vendor_name,
            r.name AS route_name, m.segments, m.client_price,
            COALESCE(m.credits_charged, m.reserved_credits, 0) AS credits_charged,
            m.error_description
     FROM messages m
     LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN vendors v ON v.id=m.vendor_id
     LEFT JOIN routes r ON r.id=m.route_id
     WHERE m.client_id=$1::uuid AND m.created_at >= $2::date
       AND m.created_at < ($3::date + interval '1 day')${extra}
     ORDER BY m.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const [cnt] = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM messages m
     WHERE m.client_id=$1::uuid AND m.created_at >= $2::date
       AND m.created_at < ($3::date + interval '1 day')${extra}`,
    params.slice(0, params.length - 2),
  );
  res.json({ range: { from, to, label }, messages: rows, total: Number(cnt.n), limit, offset });
});

// GET /reports/client/:id/export?format=csv|xls&... — respects client + date filters
router.get('/client/:id/export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { from, to, label } = reportRange(q);
  const clientId = req.params.id;
  const format = q.format === 'xls' ? 'xls' : 'csv';
  const client = await query<{ name: string }>(
    'SELECT name FROM clients WHERE id=$1::uuid', [clientId],
  ).then((r) => r[0]).catch(() => undefined);
  if (!client) {
    res.status(404).json({ error: 'client not found' });
    return;
  }
  const safe = client.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const html = (v: unknown): string =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const PAGE = 5000;
  const CAP = 200000;
  if (format === 'xls') {
    // Real Excel-readable SpreadsheetML-free format: HTML table with .xls
    // extension opens directly in Excel (no new dependency needed).
    res.setHeader('content-type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${safe}_Traffic_Report_${label}.xls"`);
    res.write(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><h2>${html(client.name)} — Traffic Report (${html(from)} to ${html(to)})</h2><table border="1"><tr><th>Date</th><th>Time</th><th>Sender</th><th>Destination</th><th>Country</th><th>Route</th><th>Vendor</th><th>Status</th><th>Segments</th><th>Charged</th></tr>`);
  } else {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${safe}_Traffic_Report_${label}.csv"`);
    res.write('Date,Time,Sender,Destination,Country,Route,Vendor,Status,Segments,Charged\n');
  }
  let offset = 0;
  try {
    for (;;) {
      const rows = await query<Record<string, unknown>>(
        `SELECT m.created_at, m.source, m.destination, co.name AS country,
                r.name AS route, v.name AS vendor, m.status, m.segments, m.client_price
         FROM messages m
         LEFT JOIN countries co ON co.id=m.country_id
         LEFT JOIN routes r ON r.id=m.route_id
         LEFT JOIN vendors v ON v.id=m.vendor_id
         WHERE m.client_id=$1::uuid AND m.created_at >= $2::date
           AND m.created_at < ($3::date + interval '1 day')
         ORDER BY m.created_at DESC LIMIT ${PAGE} OFFSET ${offset}`,
        [clientId, from, to],
      );
      for (const row of rows) {
        const d = new Date(String(row.created_at));
        if (format === 'xls') {
          res.write(`<tr><td>${d.toISOString().slice(0, 10)}</td><td>${d.toISOString().slice(11, 19)}</td><td>${html(row.source)}</td><td>${html(row.destination)}</td><td>${html(row.country)}</td><td>${html(row.route)}</td><td>${html(row.vendor)}</td><td>${html(row.status)}</td><td>${html(row.segments ?? 1)}</td><td>${html(row.client_price ?? 0)}</td></tr>`);
        } else {
          res.write([
            d.toISOString().slice(0, 10), d.toISOString().slice(11, 19),
            esc(row.source), esc(row.destination), esc(row.country),
            esc(row.route), esc(row.vendor), esc(row.status),
            String(row.segments ?? 1), String(row.client_price ?? 0),
          ].join(',') + '\n');
        }
      }
      offset += rows.length;
      if (rows.length < PAGE || offset >= CAP) break;
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: `export failed: ${(e as Error).message}` });
    return;
  }
  if (format === 'xls') res.write('</table></body></html>');
  res.end();
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
