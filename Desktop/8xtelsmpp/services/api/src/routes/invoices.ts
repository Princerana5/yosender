import { Router } from 'express';
import { z } from 'zod';
import { query, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { nextInvoiceNumber } from '../lib/invoice-numbers.js';
import { buildInvoiceHtml, buildInvoicePdfBuffer } from '../lib/invoice-pdf.js';
import { sendMail } from '../lib/mailer.js';
import { buildInvoiceEmailHtml } from '../lib/invoice-email.js';

const router = Router();

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
  const rows = await query<{
    country_id: string | null; country_name: string | null; iso_code: string | null;
    total_sms: string; successful: string; failed: string; rejected: string;
    segments: string; amount: string;
  }>(
    `SELECT m.country_id, COALESCE(co.name,'Unknown') AS country_name, co.iso_code,
            COUNT(*) AS total_sms,
            COUNT(*) FILTER (WHERE m.status='delivered') AS successful,
            COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered','expired')) AS failed,
            COUNT(*) FILTER (WHERE m.status='rejected') AS rejected,
            COALESCE(SUM(COALESCE(m.segments,1)),0) AS segments,
            COALESCE(SUM(b.client_price),0) AS amount
     FROM messages m
     LEFT JOIN billing_records b ON b.message_id=m.id
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
      rejected: Number((r as unknown as { rejected: string }).rejected ?? 0),
      segments: segs,
      rate: segs ? amount / segs : 0,
      amount,
      percentage: totalAmount ? +(amount / totalAmount * 100).toFixed(2) : 0,
    };
  });
}

async function loadPaymentMethods() {
  return query<{ id: string; kind: string; label: string; chain: string | null; details: unknown; is_active: boolean; sort_order: number }>(
    'SELECT * FROM system_payment_methods WHERE is_active=true ORDER BY sort_order, created_at',
  );
}

function toInvoiceDoc(inv: Record<string, unknown>, lines: Record<string, unknown>[]) {
  return {
    invoice_number: inv.invoice_number as string,
    period_from: String(inv.period_from).slice(0, 10),
    period_to: String(inv.period_to).slice(0, 10),
    currency: inv.currency as string,
    subtotal: Number(inv.subtotal),
    tax_rate: Number(inv.tax_rate),
    tax_amount: Number(inv.tax_amount),
    adjustments: Number(inv.adjustments),
    grand_total: Number(inv.grand_total),
    status: inv.status as string,
    notes: inv.notes as string | null,
    created_at: String(inv.created_at),
    client: {
      name: inv.client_name as string,
      company_name: inv.company_name as string | null,
      system_id: inv.system_id as string,
      email: (inv.portal_email as string | null) ?? null,
    },
    lines: lines.map((l) => ({
      country_name: String(l.country_name), iso_code: l.iso_code as string | null,
      total_sms: Number(l.total_sms), successful: Number(l.successful), failed: Number(l.failed), rejected: Number((l as Record<string, unknown>).rejected ?? 0),
      segments: Number(l.segments), rate: Number(l.rate), amount: Number(l.amount), percentage: Number(l.percentage),
    })),
  };
}

// POST /invoices/generate
router.post('/generate', requirePerm('billing.manage'), audit('generated_invoice', 'invoice'), async (req, res) => {
  const parsed = genSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  const { client_id, from, to, tax_rate, adjustments, notes } = parsed.data;
  const dryRun = parsed.data.dryRun || req.query.dryRun === '1';
  if (from > to) { res.status(400).json({ error: 'from must be <= to' }); return; }
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
        `INSERT INTO invoice_lines (invoice_id, country_id, country_name, iso_code, total_sms, successful, failed, rejected, segments, rate, amount, percentage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [inv.id, l.country_id, l.country_name, l.iso_code, l.total_sms, l.successful, l.failed, l.rejected, l.segments, l.rate, l.amount, l.percentage],
      );
    }
    await db.query('COMMIT');
    res.status(201).json({ invoice: inv, lines });
  } catch (e) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: (e as Error).message });
  } finally { db.release(); }
});

// GET /invoices
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
  const payments = await query('SELECT * FROM invoice_payments WHERE invoice_id=$1::uuid ORDER BY created_at DESC', [req.params.id]).catch(() => []);
  const paymentMethods = await loadPaymentMethods().catch(() => []);
  res.json({ invoice: inv[0], lines, emails, payments, payment_methods: paymentMethods });
});

// GET /invoices/:id/payments
router.get('/:id/payments', async (req, res) => {
  const rows = await query('SELECT * FROM invoice_payments WHERE invoice_id=$1::uuid ORDER BY created_at DESC', [req.params.id]);
  res.json({ payments: rows });
});

// POST /invoices/:id/payment — admin records a payment claim
const paymentSchema = z.object({
  method: z.enum(['bank', 'upi', 'usdt', 'wire', 'other']),
  chain: z.enum(['TRC20', 'ERC20', 'BEP20', 'Polygon', 'Other']).nullable().optional(),
  details: z.record(z.unknown()).default({}),
  amount: z.number().optional(),
  reference: z.string().max(200).optional(),
});

router.post('/:id/payment', requirePerm('billing.manage'), audit('created_invoice_payment', 'invoice_payment'), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  if (parsed.data.method === 'usdt' && !parsed.data.chain) { res.status(422).json({ error: 'chain is required for usdt (TRC20/ERC20/BEP20/Polygon/Other)' }); return; }
  const inv = await query('SELECT id FROM invoices WHERE id=$1::uuid', [req.params.id]);
  if (!inv.length) { res.status(404).json({ error: 'invoice not found' }); return; }
  const details = { ...parsed.data.details as Record<string, unknown>, ...(parsed.data.reference ? { reference: parsed.data.reference } : {}) };
  const { rows } = await getPool().query(
    `INSERT INTO invoice_payments (invoice_id, method, chain, details, amount, status, created_by)
     VALUES ($1::uuid,$2,$3,$4,$5,'pending',$6) RETURNING *`,
    [req.params.id, parsed.data.method, parsed.data.chain ?? null, JSON.stringify(details), parsed.data.amount ?? null, (req.user as { id: string }).id],
  );
  await getPool().query('UPDATE invoices SET payment_method=$1, payment_chain=$2, updated_at=now() WHERE id=$3::uuid', [parsed.data.method, parsed.data.chain ?? null, req.params.id]);
  res.status(201).json({ payment: rows[0] });
});

router.post('/:id/payment/:pid/verify', requirePerm('billing.manage'), audit('verified_invoice_payment', 'invoice_payment'), async (req, res) => {
  const body = z.object({ action: z.enum(['verify', 'reject']) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  const p = await query('SELECT * FROM invoice_payments WHERE id=$1::uuid AND invoice_id=$2::uuid', [req.params.pid, req.params.id]);
  if (!p.length) { res.status(404).json({ error: 'payment not found' }); return; }
  const status = body.data.action === 'verify' ? 'verified' : 'rejected';
  await getPool().query('UPDATE invoice_payments SET status=$1, verified_at=now(), verified_by=$2 WHERE id=$3::uuid', [status, (req.user as { id: string }).id, req.params.pid]);
  if (status === 'verified') {
    await getPool().query("UPDATE invoices SET status='paid', paid_at=now(), paid_by=$1, updated_at=now() WHERE id=$2::uuid", [(req.user as { id: string }).id, req.params.id]);
  }
  const updated = await query('SELECT * FROM invoice_payments WHERE id=$1::uuid', [req.params.pid]);
  const inv = await query('SELECT * FROM invoices WHERE id=$1::uuid', [req.params.id]);
  res.json({ payment: updated[0], invoice: inv[0] });
});

// GET /invoices/:id/pdf — real PDF (pdfkit) with fallback to HTML
router.get('/:id/pdf', async (req, res) => {
  const inv = await query('SELECT i.*, c.name AS client_name, c.company_name, c.system_id, c.portal_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=$1::uuid', [req.params.id]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  const lines = await query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY amount DESC', [req.params.id]);
  const methods = await loadPaymentMethods().catch(() => []);
  const doc = toInvoiceDoc(inv[0] as Record<string, unknown>, lines as Record<string, unknown>[]);
  const payForDoc = methods.map(m => ({ kind: m.kind, label: m.label, chain: m.chain, details: (typeof m.details === 'string' ? JSON.parse(m.details) : m.details) as Record<string, unknown> }));
  const wantsPdf = String(req.query.format ?? 'pdf') !== 'html';
  if (wantsPdf) {
    try {
      const pdf = await buildInvoicePdfBuffer(doc, payForDoc);
      // detect real PDF vs HTML fallback by header
      const isPdf = pdf[0] === 0x25 && pdf[1] === 0x50; // %P
      if (isPdf) {
        res.setHeader('content-type', 'application/pdf');
        res.setHeader('content-disposition', `inline; filename="Invoice_${doc.invoice_number}.pdf"`);
        res.send(pdf);
        return;
      }
    } catch { /* fall through to html */ }
  }
  const html = buildInvoiceHtml(doc, payForDoc);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('content-disposition', `inline; filename="${doc.invoice_number}.html"`);
  res.send(Buffer.from(html, 'utf8'));
});

// PATCH /invoices/:id — edit notes/tax/adjustments/status (recalcs totals when tax/adj change)
router.patch('/:id', requirePerm('billing.manage'), audit('updated_invoice', 'invoice'), async (req, res) => {
  const body = z.object({
    status: z.enum(['draft','generated','sent','paid','unpaid','overdue','cancelled']).optional(),
    notes: z.string().max(2000).optional().nullable(),
    tax_rate: z.number().min(0).max(100).optional(),
    adjustments: z.number().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  const cur = await query<{ status: string; subtotal: string }>('SELECT status, subtotal FROM invoices WHERE id=$1::uuid', [req.params.id]);
  if (!cur.length) { res.status(404).json({ error: 'not found' }); return; }
  const from = cur[0].status;
  const to = body.data.status;
  if (from === 'cancelled' && to && to !== 'cancelled') { res.status(422).json({ error: 'cancelled invoice is terminal' }); return; }
  if (to) {
    if (to === 'paid') await query("UPDATE invoices SET status='paid', paid_at=now(), paid_by=$1, updated_at=now() WHERE id=$2::uuid", [(req.user as { id: string }).id, req.params.id]);
    else await query('UPDATE invoices SET status=$1, updated_at=now() WHERE id=$2::uuid', [to, req.params.id]);
  }
  // recalc totals if tax_rate or adjustments changed
  if (body.data.tax_rate !== undefined || body.data.adjustments !== undefined) {
    if (from === 'paid' || from === 'cancelled') { res.status(422).json({ error: `cannot edit ${from} invoice` }); return; }
    const subtotal = Number(cur[0].subtotal);
    const effTax = body.data.tax_rate ?? Number((await query<{ tax_rate: string }>('SELECT tax_rate FROM invoices WHERE id=$1::uuid', [req.params.id]))[0]?.tax_rate ?? 0);
    const effAdj = body.data.adjustments ?? Number((await query<{ adjustments: string }>('SELECT adjustments FROM invoices WHERE id=$1::uuid', [req.params.id]))[0]?.adjustments ?? 0);
    const taxRate = body.data.tax_rate !== undefined ? body.data.tax_rate : effTax;
    const adj = body.data.adjustments !== undefined ? body.data.adjustments : effAdj;
    const taxAmount = +(subtotal * taxRate / 100).toFixed(6);
    const grandTotal = +(subtotal + taxAmount + adj).toFixed(6);
    const sets: string[] = []; const vals: unknown[] = [];
    if (body.data.tax_rate !== undefined) { vals.push(taxRate); sets.push(`tax_rate=$${vals.length}`); }
    if (body.data.adjustments !== undefined) { vals.push(adj); sets.push(`adjustments=$${vals.length}`); }
    // always update derived amounts when either changes
    vals.push(taxAmount); sets.push(`tax_amount=$${vals.length}`);
    vals.push(grandTotal); sets.push(`grand_total=$${vals.length}`);
    vals.push(req.params.id);
    await query(`UPDATE invoices SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}::uuid`, vals);
  }
  if (body.data.notes !== undefined) await query('UPDATE invoices SET notes=$1, updated_at=now() WHERE id=$2::uuid', [body.data.notes, req.params.id]);
  const updated = await query('SELECT * FROM invoices WHERE id=$1::uuid', [req.params.id]);
  res.json({ invoice: updated[0] });
});

// DELETE /invoices/:id — delete draft/generated (cancelled-then-purge); paid/sent require cancel first
router.delete('/:id', requirePerm('billing.manage'), audit('deleted_invoice', 'invoice'), async (req, res) => {
  const cur = await query<{ status: string }>('SELECT status FROM invoices WHERE id=$1::uuid', [req.params.id]);
  if (!cur.length) { res.status(404).json({ error: 'not found' }); return; }
  if (!['draft','generated','cancelled'].includes(cur[0].status)) { res.status(422).json({ error: `cannot delete ${cur[0].status} invoice — cancel it first` }); return; }
  await getPool().query('DELETE FROM invoices WHERE id=$1::uuid', [req.params.id]);
  res.json({ ok: true });
});

// POST /invoices/:id/send — professional mail + PDF attachment
router.post('/:id/send', requirePerm('billing.manage'), audit('sent_invoice', 'invoice'), async (req, res) => {
  const body = z.object({
    to_email: z.string().email().optional(),
    to: z.string().email().optional(),
    to_emails: z.array(z.string().email()).max(10).optional(),
    cc: z.array(z.string().email()).max(10).optional(),
    bcc: z.array(z.string().email()).max(10).optional(),
    subject: z.string().max(200).optional(),
    intro: z.string().max(2000).optional(),
  }).safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: 'invalid payload', details: body.error.flatten() }); return; }
  const inv = await query<{ client_id: string; status: string; invoice_number: string }>('SELECT client_id, status, invoice_number FROM invoices WHERE id=$1::uuid', [req.params.id]);
  if (!inv.length) { res.status(404).json({ error: 'not found' }); return; }
  if (inv[0].status === 'cancelled') { res.status(422).json({ error: 'cannot send cancelled invoice' }); return; }
  // normalize recipients
  let toList: string[] = [];
  if (body.data.to_emails?.length) toList = body.data.to_emails;
  else if (body.data.to_email) toList = [body.data.to_email];
  else if (body.data.to) toList = [body.data.to];
  if (!toList.length) {
    const cl = await query<{ portal_email: string | null }>('SELECT portal_email FROM clients WHERE id=$1', [inv[0].client_id]);
    if (cl[0]?.portal_email) toList = [cl[0].portal_email];
  }
  if (!toList.length) { res.status(422).json({ error: 'no recipient — provide to_email / to_emails' }); return; }
  const ccList = body.data.cc ?? [];
  const bccList = body.data.bcc ?? [];

  const full = await query('SELECT i.*, c.name AS client_name, c.company_name, c.system_id, c.portal_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=$1::uuid', [req.params.id]);
  const lines = await query('SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY amount DESC', [req.params.id]);
  const methods = await loadPaymentMethods().catch(() => []);
  const doc = toInvoiceDoc(full[0] as Record<string, unknown>, lines as Record<string, unknown>[]);
  const payForDoc = methods.map(m => ({ kind: m.kind, label: m.label, chain: m.chain, details: (typeof m.details === 'string' ? JSON.parse(m.details) : m.details) as Record<string, unknown> }));
  const panelUrl = (process.env.PANEL_HOST ?? process.env.FRONTEND_URL ?? '').replace(/\/$/, '') || 'https://8xtelsmpp.com';
  const subjectOverride = body.data.subject?.trim() ? body.data.subject.trim() : null;
  const subject = subjectOverride ?? `Invoice ${doc.invoice_number} — ${doc.period_from} to ${doc.period_to} — 8xtel`;
  const html = buildInvoiceEmailHtml({ doc, paymentMethods: payForDoc, panelUrl, invoiceId: req.params.id, subjectOverride, introOverride: body.data.intro ?? null });
  const pdfBuffer = await buildInvoicePdfBuffer(doc, payForDoc);
  const isPdf = pdfBuffer[0] === 0x25 && pdfBuffer[1] === 0x50;
  const filename = `Invoice_${doc.invoice_number}.${isPdf ? 'pdf' : 'html'}`;

  let error: string | null = null;
  let messageId: string | null = null;
  try {
    const r = await sendMail({
      from: `"8xtel Accounts" <${process.env.BILLING_SMTP_USER ?? process.env.BILLING_FROM_EMAIL ?? 'Accounts@8xtel.com'}>`,
      replyTo: process.env.BILLING_SMTP_USER ?? 'Accounts@8xtel.com',
      to: toList.join(', '),
      cc: ccList.length ? ccList : undefined,
      bcc: bccList.length ? bccList : undefined,
      subject,
      html,
      attachments: [{ filename, content: pdfBuffer, contentType: isPdf ? 'application/pdf' : 'text/html' }],
    });
    messageId = r.messageId;
  } catch (e) { error = (e as Error).message; }
  const toForLog = toList.join(', ');
  const ccStr = ccList.length ? ccList.join(', ') : null;
  const bccStr = bccList.length ? bccList.join(', ') : null;
  // store cc/bcc/subject when columns exist, otherwise fallback
  try {
    await query('INSERT INTO invoice_emails (invoice_id, to_email, cc, bcc, subject, sent_by, message_id, error) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8)', [req.params.id, toForLog, ccStr, bccStr, subject, (req.user as { id: string }).id, messageId, error]);
  } catch {
    await query('INSERT INTO invoice_emails (invoice_id, to_email, sent_by, message_id, error) VALUES ($1::uuid,$2,$3,$4,$5)', [req.params.id, toForLog, (req.user as { id: string }).id, messageId, error]);
  }
  if (!error) await query("UPDATE invoices SET status='sent', updated_at=now() WHERE id=$1::uuid AND status IN ('generated','draft')", [req.params.id]);
  const updated = await query('SELECT * FROM invoices WHERE id=$1::uuid', [req.params.id]);
  res.json({ invoice: updated[0], emailed_to: toForLog, emailed_cc: ccStr, emailed_bcc: bccStr, message_id: messageId, error });
});

// POST /invoices/:id/regenerate
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
        `INSERT INTO invoice_lines (invoice_id, country_id, country_name, iso_code, total_sms, successful, failed, rejected, segments, rate, amount, percentage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [rows[0].id, l.country_id, l.country_name, l.iso_code, l.total_sms, l.successful, l.failed, l.rejected, l.segments, l.rate, l.amount, l.percentage],
      );
    }
    await db.query('COMMIT');
    res.status(201).json({ invoice: rows[0], lines, previous_id: req.params.id });
  } catch (e) { await db.query('ROLLBACK'); res.status(500).json({ error: (e as Error).message }); } finally { db.release(); }
});

export default router;
