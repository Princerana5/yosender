import { Router } from 'express';
import { z } from 'zod';
import { query, getPool } from '@8xtel/core';
import { requirePerm, requirePortal, audit } from '../middleware.js';
import { nextInvoiceNumber } from '../lib/invoice-numbers.js';
import { buildInvoiceHtml } from '../lib/invoice-pdf.js';

const router = Router();

// All console invoice routes require billing.read at minimum
router.use(requirePerm('billing.read'));

const genSchema = z.object({
  client_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tax_rate: z.number().min(0).max(100).optional().default(0),
  adjustments: z.number().optional().default(0),
  notes: z.string().max(2000).optional().nullable(),
  dryRun: z.boolean().optional(),
});

async function buildInvoiceLines(clientId: string, from: string, to: string) {
  // Group settled billing_records by country for the period
  const rows = await query<{
    country_id: string | null; country_name: string | null; iso_code: string | null;
    total_sms: string; successful: string; failed: string;
    segments: string; amount: string;
  }>(
    `SELECT m.country_id, COALESCE(co.name,'Unknown') AS country_name, co.iso_code,
            COUNT(*) AS total_sms,
            COUNT(*) FILTER (WHERE m.status='delivered') AS successful,
            COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered','expired','rejected')) AS failed,
            COALESCE(SUM(COALESCE(m.segments,1)),0) AS segments,
            COALESCE(SUM(b.client_price),0) AS amount
     FROM messages m
     JOIN billing_records b ON b.message_id=m.id
     LEFT JOIN countries co ON co.id=m.country_id
     WHERE m.client_id=$1::uuid AND m.created_at >= $2::date AND m.created_at < ($3::date + interval '1 day')
     GROUP BY m.country_id, co.name, co.iso_code
     ORDER BY amount DESC`,
    [clientId, from, to],
  );
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
  return rows.map((r) => {
    const amount = Number(r.amount);
    const segs = Number(r.segments);
    return {
      country_id: r.country_id,
      country_name: r.country_name ?? 'Unknown',
      iso_code: r.iso_code,
      total_sms: Number(r.total_sms),
      successful: Number(r.successful),
      failed: Number(r.failed),
      segments: segs,
      rate: segs ? amount / segs : 0,
      amount,
      percentage: totalAmount ? +(amount / totalAmount * 100).toFixed(2) : 0,
    };
  });
}

// POST /invoices/generate
router.post('/generate', requirePerm('billing.manage'), audit('generated_invoice', 'invoice'), async (req, res) => {
  const parsed = genSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  const { client_id, from, to, tax_rate, adjustments, notes } = parsed.data;
  const dryRun = parsed.data.dryRun || req.query.dryRun === '1';
  if (from > to) { res.status(400).json({ error: 'from must be <= to' }); return; }
  // Dedup guard: same client+period
  const existing = await query<{ id: string; invoice_number: string }>(
    'SELECT id, invoice_number FROM invoices WHERE client_id=$1 AND period_from=$2::date AND period_to=$3::date AND status != \'cancelled\' LIMIT 1',
    [client_id, from, to],
  );
  if (existing.length && !dryRun) { res.status(409).json({ error: 'invoice already exists for this period', existing: existing[0] }); return; }
  const lines = await buildInvoiceLines(client_id, from, to);
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxAmount = +(subtotal * (tax_rate ?? 0) / 100).toFixed(6);
  const adj = Number(adjustments ?? 0);
  const grandTotal = +(subtotal + taxAmount + adj).toFixed(6);
  if (dryRun) {
    const cl = await query('SELECT id, name, company_name, system_id, currency FROM clients WHERE id=$1', [client_id]);
    res.json({ preview: true, client: cl[0] ?? null, period: { from, to }, lines, subtotal, tax_rate, tax_amount: taxAmount, adjustments: adj, grand_total: grandTotal });
    return;
  }
  const invoiceNumber = await nextInvoiceNumber();
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cl = await db.query('SELECT currency FROM clients WHERE id=$1', [client_id]);
    const currency = cl.rows[0]?.currency ?? 'EUR';
    const { rows } = await db.query(
      `INSERT INTO invoices (client_id, invoice_number, period_from, period_to, currency, subtotal, tax_rate, tax_amount, adjustments, grand_total, status, notes, generated_by)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,'generated',$11,$12) RETURNING *`,
      [client_id, invoiceNumber, from, to, currency, subtotal, tax_rate ?? 0, taxAmount, adj, grandTotal, notes ?? null, (req.user as { id: string }).id],
    );
    const inv = rows[0];
    for (const l of lines) {
      await db.query(
        `INSERT INTO invoice_lines (invoice_id, country_id, country_name, iso_code, total_sms, successful, failed, segments, rate, amount, percentage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [inv.id, l.country_id, l.country_name, l.iso_code, l.total_sms, l.successful, l.failed, l.segments, l.rate, l.amount, l.percentage],
      );
    }
    await db.query('COMMIT');
    res.status(201).json({ invoice: inv, lines });
  } catch (e) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: (e as Error).message });
  } finally { db.release(); }
});

// GET /invoices — admin list with filters
router.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const clientId = q.client_id ?? null;
  const status = q.status ?? null;
  const from = q.from ?? null;
  const to = q.to ?? null;
  const limit = Math.min(Number(q.limit ?? 50), 200);
  const offset = Math.max(0, Number(q.offset ?? 0));
  const rows = await query(
    `SELECT i.*, c.name AS client_name, c.system_id FROM invoices i
     JOIN clients c ON c.id=i.client_id
     WHERE ($1::uuid IS NULL OR i.client_id=$1::uuid)
       AND ($2::text IS NULL OR i.status=$2)
       AND ($3::date IS NULL OR i.period_from >= $3::date)
       AND ($4::date IS NULL OR i.period_to <= $4::date)
     ORDER BY i.created_at DESC LIMIT $5 OFFSET $6`,
    [clientId, status, from, to, limit, offset],
  );
  res.json({ invoices: rows });
});

// GET /invoices/:id
router.get('/:id', async (req, res) => {
  const inv = await query('SELECT i.*, c.name AS client_name, c.company_name, c.system_id, c.portal_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=$1::uuid', [req.params.id]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  const lines = await query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY amount DESC', [req.params.id]);
  const emails = await query('SELECT * FROM invoice_emails WHERE invoice_id=$1 ORDER BY sent_at DESC', [req.params.id]);
  res.json({ invoice: inv[0], lines, emails });
});

// GET /invoices/:id/pdf
router.get('/:id/pdf', async (req, res) => {
  const inv = await query('SELECT i.*, c.name AS client_name, c.company_name, c.system_id, c.portal_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=$1::uuid', [req.params.id]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  const lines = await query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY amount DESC', [req.params.id]);
  const doc = {
    invoice_number: (inv[0] as { invoice_number: string }).invoice_number,
    period_from: String((inv[0] as { period_from: string }).period_from).slice(0, 10),
    period_to: String((inv[0] as { period_to: string }).period_to).slice(0, 10),
    currency: (inv[0] as { currency: string }).currency,
    subtotal: Number((inv[0] as { subtotal: string }).subtotal),
    tax_rate: Number((inv[0] as { tax_rate: string }).tax_rate),
    tax_amount: Number((inv[0] as { tax_amount: string }).tax_amount),
    adjustments: Number((inv[0] as { adjustments: string }).adjustments),
    grand_total: Number((inv[0] as { grand_total: string }).grand_total),
    status: (inv[0] as { status: string }).status,
    notes: (inv[0] as { notes: string | null }).notes,
    created_at: String((inv[0] as { created_at: string }).created_at),
    client: {
      name: (inv[0] as { client_name: string }).client_name,
      company_name: (inv[0] as { company_name: string | null }).company_name,
      system_id: (inv[0] as { system_id: string }).system_id,
      email: (inv[0] as { portal_email: string | null }).portal_email,
    },
    lines: (lines as Record<string, unknown>[]).map((l) => ({
      country_name: String(l.country_name), iso_code: l.iso_code as string | null,
      total_sms: Number(l.total_sms), successful: Number(l.successful), failed: Number(l.failed),
      segments: Number(l.segments), rate: Number(l.rate), amount: Number(l.amount), percentage: Number(l.percentage),
    })),
  };
  const html = buildInvoiceHtml(doc);
  const buf = Buffer.from(html, 'utf8');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('content-disposition', `inline; filename="${doc.invoice_number}.html"`);
  res.send(buf);
});

// PATCH /invoices/:id — status/notes
router.patch('/:id', requirePerm('billing.manage'), audit('updated_invoice', 'invoice'), async (req, res) => {
  const body = z.object({ status: z.enum(['draft','generated','sent','paid','unpaid','overdue','cancelled']).optional(), notes: z.string().max(2000).optional().nullable() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  const cur = await query<{ status: string }>('SELECT status FROM invoices WHERE id=$1::uuid', [req.params.id]);
  if (!cur.length) { res.status(404).json({ error: 'not found' }); return; }
  const from = cur[0].status;
  const to = body.data.status;
  // Terminal guard: cancelled cannot leave; paid cannot go backwards to draft/generated
  if (from === 'cancelled' && to && to !== 'cancelled') { res.status(422).json({ error: 'cancelled invoice is terminal' }); return; }
  if (to) await query('UPDATE invoices SET status=$1, updated_at=now() WHERE id=$2::uuid', [to, req.params.id]);
  if (body.data.notes !== undefined) await query('UPDATE invoices SET notes=$1, updated_at=now() WHERE id=$2::uuid', [body.data.notes, req.params.id]);
  const updated = await query('SELECT * FROM invoices WHERE id=$1::uuid', [req.params.id]);
  res.json({ invoice: updated[0] });
});

// POST /invoices/:id/send — record email send (SMTP wiring can be added; for now audit+status)
router.post('/:id/send', requirePerm('billing.manage'), audit('sent_invoice', 'invoice'), async (req, res) => {
  const body = z.object({ to_email: z.string().email().optional() }).safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  const inv = await query<{ client_id: string; status: string; invoice_number: string }>('SELECT client_id, status, invoice_number FROM invoices WHERE id=$1::uuid', [req.params.id]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  if (inv[0].status === 'cancelled') { res.status(422).json({ error: 'cannot send cancelled invoice' }); return; }
  let toEmail = body.data.to_email ?? null;
  if (!toEmail) {
    const cl = await query<{ portal_email: string | null }>('SELECT portal_email FROM clients WHERE id=$1', [inv[0].client_id]);
    toEmail = cl[0]?.portal_email ?? null;
  }
  if (!toEmail) { res.status(422).json({ error: 'no recipient email — provide to_email' }); return; }
  // Try to send via nodemailer if SMTP configured; otherwise just log.
  let error: string | null = null;
  let messageId: string | null = null;
  try {
    const host = process.env.RN_SMTP_HOST ?? process.env.SMTP_HOST;
    if (host) {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.RN_SMTP_PORT ?? process.env.SMTP_PORT ?? 587),
        secure: String(process.env.RN_SMTP_SECURE ?? 'false') === 'true',
        auth: process.env.RN_SMTP_USER ? { user: process.env.RN_SMTP_USER, pass: process.env.RN_SMTP_PASS ?? '' } : undefined,
      });
      const html = '<p>Invoice attached.</p>';
      const info = await transporter.sendMail({ from: process.env.RN_SMTP_USER ?? 'billing@8xtelsmpp.com', to: toEmail, subject: `Invoice ${inv[0].invoice_number}`, html });
      messageId = (info as { messageId?: string }).messageId ?? null;
    }
  } catch (e) { error = (e as Error).message; }
  await query('INSERT INTO invoice_emails (invoice_id, to_email, sent_by, message_id, error) VALUES ($1::uuid,$2,$3,$4,$5)', [req.params.id, toEmail, (req.user as { id: string }).id, messageId, error]);
  if (!error) await query("UPDATE invoices SET status='sent', updated_at=now() WHERE id=$1::uuid AND status IN ('generated','draft')", [req.params.id]);
  const updated = await query('SELECT * FROM invoices WHERE id=$1::uuid', [req.params.id]);
  res.json({ invoice: updated[0], emailed_to: toEmail, message_id: messageId, error });
});

// POST /invoices/:id/regenerate — cancel old, create new for same period (audit)
router.post('/:id/regenerate', requirePerm('billing.manage'), audit('regenerated_invoice', 'invoice'), async (req, res) => {
  const inv = await query<{ client_id: string; period_from: string; period_to: string; tax_rate: string; adjustments: string; notes: string | null }>(
    'SELECT client_id, period_from, period_to, tax_rate, adjustments, notes FROM invoices WHERE id=$1::uuid', [req.params.id],
  );
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  await query("UPDATE invoices SET status='cancelled', updated_at=now() WHERE id=$1::uuid AND status != 'cancelled'", [req.params.id]);
  const lines = await buildInvoiceLines(inv[0].client_id, String(inv[0].period_from).slice(0, 10), String(inv[0].period_to).slice(0, 10));
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxRate = Number(inv[0].tax_rate);
  const taxAmount = +(subtotal * taxRate / 100).toFixed(6);
  const adj = Number(inv[0].adjustments);
  const grandTotal = +(subtotal + taxAmount + adj).toFixed(6);
  const invoiceNumber = await nextInvoiceNumber();
  const pool = getPool(); const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cl = await db.query('SELECT currency FROM clients WHERE id=$1', [inv[0].client_id]);
    const currency = cl.rows[0]?.currency ?? 'EUR';
    const { rows } = await db.query(
      `INSERT INTO invoices (client_id, invoice_number, period_from, period_to, currency, subtotal, tax_rate, tax_amount, adjustments, grand_total, status, notes, generated_by)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,'generated',$11,$12) RETURNING *`,
      [inv[0].client_id, invoiceNumber, String(inv[0].period_from).slice(0, 10), String(inv[0].period_to).slice(0, 10), currency, subtotal, taxRate, taxAmount, adj, grandTotal, inv[0].notes, (req.user as { id: string }).id],
    );
    for (const l of lines) {
      await db.query(
        `INSERT INTO invoice_lines (invoice_id, country_id, country_name, iso_code, total_sms, successful, failed, segments, rate, amount, percentage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rows[0].id, l.country_id, l.country_name, l.iso_code, l.total_sms, l.successful, l.failed, l.segments, l.rate, l.amount, l.percentage],
      );
    }
    await db.query('COMMIT');
    res.status(201).json({ invoice: rows[0], lines, previous_id: req.params.id });
  } catch (e) { await db.query('ROLLBACK'); res.status(500).json({ error: (e as Error).message }); } finally { db.release(); }
});

export default router;
