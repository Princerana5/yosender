import { query, getPool } from '@8xtel/core';
import { nextInvoiceNumber } from '../lib/invoice-numbers.js';

function priorMonthRange(now = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-indexed, prior month
  let py = y;
  if (m === 0) { m = 12; py = y - 1; }
  const from = `${py}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(py, m, 0)).getUTCDate();
  const to = `${py}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

async function buildAndInsert(clientId: string, from: string, to: string): Promise<string | null> {
  const exists = await query('SELECT id FROM invoices WHERE client_id=$1 AND period_from=$2::date AND period_to=$3::date AND status != \'cancelled\' LIMIT 1', [clientId, from, to]);
  if (exists.length) return null;
  const hasTraffic = await query('SELECT 1 FROM billing_records b JOIN messages m ON m.id=b.message_id WHERE m.client_id=$1 AND m.created_at >= $2::date AND m.created_at < ($3::date + interval \'1 day\') LIMIT 1', [clientId, from, to]);
  if (!hasTraffic.length) return null;
  // reuse buildInvoiceLines logic inline
  const rows = await query<{ country_id: string | null; country_name: string | null; iso_code: string | null; total_sms: string; successful: string; failed: string; segments: string; amount: string }>(
    `SELECT m.country_id, COALESCE(co.name,'Unknown') AS country_name, co.iso_code,
            COUNT(*) AS total_sms,
            COUNT(*) FILTER (WHERE m.status='delivered') AS successful,
            COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered','expired','rejected')) AS failed,
            COALESCE(SUM(COALESCE(m.segments,1)),0) AS segments,
            COALESCE(SUM(b.client_price),0) AS amount
     FROM messages m JOIN billing_records b ON b.message_id=m.id
     LEFT JOIN countries co ON co.id=m.country_id
     WHERE m.client_id=$1::uuid AND m.created_at >= $2::date AND m.created_at < ($3::date + interval '1 day')
     GROUP BY m.country_id, co.name, co.iso_code ORDER BY amount DESC`,
    [clientId, from, to],
  );
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
  const lines = rows.map(r => {
    const amount = Number(r.amount); const segs = Number(r.segments);
    return { country_id: r.country_id, country_name: r.country_name ?? 'Unknown', iso_code: r.iso_code, total_sms: Number(r.total_sms), successful: Number(r.successful), failed: Number(r.failed), segments: segs, rate: segs ? amount / segs : 0, amount, percentage: totalAmount ? +(amount / totalAmount * 100).toFixed(2) : 0 };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const invoiceNumber = await nextInvoiceNumber(new Date(from + 'T12:00:00Z'));
  // status draft for auto
  const pool = getPool(); const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cl = await db.query('SELECT currency FROM clients WHERE id=$1', [clientId]);
    const currency = cl.rows[0]?.currency ?? 'EUR';
    const { rows: invRows } = await db.query(
      `INSERT INTO invoices (client_id, invoice_number, period_from, period_to, currency, subtotal, tax_rate, tax_amount, adjustments, grand_total, status)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,0,0,0,$6,'draft') RETURNING id, invoice_number`,
      [clientId, invoiceNumber, from, to, currency, subtotal],
    );
    for (const l of lines) {
      await db.query(`INSERT INTO invoice_lines (invoice_id, country_id, country_name, iso_code, total_sms, successful, failed, segments, rate, amount, percentage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [invRows[0].id, l.country_id, l.country_name, l.iso_code, l.total_sms, l.successful, l.failed, l.segments, l.rate, l.amount, l.percentage]);
    }
    await db.query('COMMIT');
    return invRows[0].invoice_number as string;
  } catch (e) {
    await db.query('ROLLBACK'); throw e;
  } finally { db.release(); }
}

export function startAutoInvoiceJob(): void {
  if (String(process.env.AUTO_INVOICE_CRON ?? '1') !== '1') {
    console.log('[auto-invoices] disabled (AUTO_INVOICE_CRON != 1)');
    return;
  }
  const run = async (): Promise<void> => {
    try {
      const { from, to } = priorMonthRange(new Date());
      const clients = await query<{ id: string }>(`SELECT id FROM clients WHERE status='active' AND COALESCE(is_house,false)=false`);
      let created = 0;
      for (const c of clients) {
        try {
          const n = await buildAndInsert(c.id, from, to);
          if (n) { created++; console.log(`[auto-invoices] draft ${n} for ${c.id} ${from}→${to}`); }
        } catch (e) { console.warn(`[auto-invoices] ${c.id}:`, (e as Error).message); }
      }
      if (created) console.log(`[auto-invoices] done: ${created} drafts for ${from}→${to}`);
    } catch (e) { console.error('[auto-invoices] run failed:', (e as Error).message); }
  };
  // run once shortly after boot if today is the 1st, otherwise just schedule
  const now = new Date();
  const isFirst = now.getUTCDate() === 1;
  if (isFirst) setTimeout(run, 30_000);
  // daily check at 02:00 UTC
  const msUntilNext02 = (() => {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  })();
  setTimeout(() => {
    const check = (): void => {
      if (new Date().getUTCDate() === 1) run().catch(() => {});
    };
    check();
    setInterval(check, 24 * 60 * 60 * 1000);
  }, msUntilNext02);
  console.log('[auto-invoices] scheduled — next check in', Math.round(msUntilNext02 / 1000 / 60), 'min, then daily 02:00 UTC');
}
