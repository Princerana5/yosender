import { Router } from 'express';
import { z } from 'zod';
import nodemailer, { type Transporter } from 'nodemailer';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { getClientActiveRates, buildClientRatesXlsx, attachmentFilename } from './rate-excel.js';

const router = Router();
// All RN endpoints need an admin-level permission; reuse clients.update so no
// seed change is required (admins/operations already hold it).
router.use(requirePerm('clients.update'));

const SENDER_NAME = '8xtel Rate Notification';
const SENDER_EMAIL = 'rates@8xtel.com';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const norm = (e: string): string => e.trim().toLowerCase();

// ── Mail sender (env-only credentials, never frontend) ────────────────────────
export interface RnAttachment { filename: string; content: Buffer; }
async function sendRnMail(opts: { to: string; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: RnAttachment[] }): Promise<void> {
  const mode = (process.env.RN_MAIL_MODE ?? 'auto').toLowerCase();
  const smtpErr = await trySmtp(opts).catch((e) => e as Error);
  if (!smtpErr) return;
  if (mode === 'smtp') throw smtpErr;
  console.warn(`[rn] smtp failed (${smtpErr.message}) — trying roundcube webmail`);
  await sendViaRoundcube(opts);
  console.log('[rn] sent via roundcube webmail fallback');
}

let transporter: Transporter | null = null;
function trySmtp(opts: { to: string; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: RnAttachment[] }): Promise<void> {
  const { RN_SMTP_HOST, RN_SMTP_PORT, RN_SMTP_USER, RN_SMTP_PASS, RN_SMTP_SECURE } = process.env;
  if (!RN_SMTP_HOST || !RN_SMTP_USER || !RN_SMTP_PASS) {
    return Promise.reject(new Error('rate-notification SMTP not configured (RN_SMTP_HOST/RN_SMTP_USER/RN_SMTP_PASS)'));
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: RN_SMTP_HOST,
      port: Number(RN_SMTP_PORT ?? 587),
      secure: String(RN_SMTP_SECURE ?? 'false') === 'true',
      auth: { user: RN_SMTP_USER, pass: RN_SMTP_PASS },
    });
  }
  const t = transporter;
  return t.sendMail({
    from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
    to: opts.to,
    cc: opts.cc?.length ? opts.cc.join(', ') : undefined,
    bcc: opts.bcc?.length ? opts.bcc.join(', ') : undefined,
    replyTo: SENDER_EMAIL,
    subject: opts.subject,
    html: opts.html,
    attachments: (opts.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
  }).then(() => undefined);
}

async function sendViaRoundcube(opts: { to: string; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: RnAttachment[] }): Promise<void> {
  const base = (process.env.RN_WEBMAIL_BASE ?? 'https://nvme05.netcloudns.com:2096').replace(/\/$/, '');
  const user = process.env.RN_SMTP_USER ?? SENDER_EMAIL;
  const pass = process.env.RN_SMTP_PASS;
  if (!pass) throw new Error('roundcube fallback needs RN_SMTP_PASS');
  const jar: string[] = [];
  const req = async (url: string, init?: RequestInit): Promise<{ text: string; headers: Headers }> => {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { ...(init?.headers ?? {}), ...(jar.length ? { cookie: jar.join('; ') } : {}) },
    });
    for (const c of res.headers.getSetCookie()) jar.push(c.split(';')[0]!);
    return { text: await res.text(), headers: res.headers };
  };
  const login = await req(`${base}/login/?login_only=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`,
  });
  const sess = login.text.match(/\/cpsess\d+/)?.[0];
  if (!sess) throw new Error(`roundcube login failed: ${login.text.slice(0, 120)}`);
  const rc = `${base}${sess}/3rdparty/roundcube`;
  await req(`${rc}/index.php?login=1&post_login=1`);
  const token = (await req(`${rc}/?_task=mail`)).text.match(/"request_token":"([a-zA-Z0-9]+)"/)?.[1];
  if (!token) throw new Error('roundcube token not found');
  const comp = (await req(`${rc}/?_task=mail&_action=compose`)).text;
  const cid = comp.match(/"compose_id":"([^"]+)"/)?.[1];
  if (!cid) throw new Error('roundcube compose id not found');
  const body = new URLSearchParams({
    _task: 'mail', _action: 'send', _id: cid, _token: token, _from: '2',
    _to: [opts.to, ...(opts.cc ?? [])].join(', '),
    _bcc: (opts.bcc ?? []).join(', '),
    _subject: opts.subject,
    _message: `Rate notification — please view this email in an HTML-capable client.\n\n${opts.html.replace(/<[^>]*>/g, ' ')}`,
  });
  const send = await req(`${rc}/?_task=mail&_action=send`, { method: 'POST', body });
  if (!/Message sent/i.test(send.text)) {
    throw new Error(`roundcube send failed: ${send.text.replace(/<[^>]*>/g, ' ').slice(0, 200)}`);
  }
}

// ── HTML escaping: every user-controlled field goes through this ─────────────
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const BILLING_MODE_VALUES = ['on_submission', 'on_delivery', 'submission_delivery', 'operator_submission', 'operator_delivery', 'hybrid', 'on_attempt', 'on_accepted'] as const;

export const BILLING_MODE_HELP: Record<string, string> = {
  on_submission: 'Client is charged when the message is submitted to 8xtel.',
  on_delivery: 'Client is charged only after a successful delivery confirmation.',
  submission_delivery: 'Split charge: one part on submission, the rest on delivery.',
  operator_submission: 'Charged when the operator accepts the submission.',
  operator_delivery: 'Charged when the operator confirms delivery.',
  hybrid: 'Submission charge plus operator delivery charge.',
  on_attempt: 'Charged on every routing attempt, even if retried.',
  on_accepted: 'Charged when 8xtel accepts the message for processing.',
};

const rateSchema = z.object({
  country: z.string().min(1).max(100),
  country_code: z.string().length(2).nullable().optional(),
  network_name: z.string().min(1).max(120),
  mcc: z.string().regex(/^\d{3}$/, 'MCC must be 3 digits'),
  mnc: z.string().regex(/^(\d{1,3}|ALL)$/i, 'MNC must be digits or ALL'),
  currency: z.enum(['EUR', 'USD']),
  rate: z.number().positive().max(999999),
  billing_mode: z.enum(BILLING_MODE_VALUES).default('on_submission'),
  delivery_rate: z.number().positive().max(999999).nullable().optional(),
});

const emailList = z.array(z.string().email().max(254)).max(20).default([]);

const createSchema = z.object({
  client_id: z.string().uuid(),
  valid_from: z.string().datetime({ offset: true }),
  timezone: z.string().max(32).default('GMT'),
  cc: emailList,
  bcc: emailList,
  include_attachment: z.boolean().default(true),
  rates: z.array(rateSchema).min(1).max(200),
});

export function buildSubject(accountId: string, systemId: string): string {
  return `8xtel Rate notification _${accountId}/${systemId}`;
}

function fmtValidFrom(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} GMT ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} hours`;
}

const BILLING_MODE_LABELS: Record<string, string> = {
  on_submission: 'On Submission', on_delivery: 'On Delivery Only',
  submission_delivery: 'Submission + Delivery', operator_submission: 'Operator Submission',
  operator_delivery: 'Operator Delivery', hybrid: 'Hybrid: Submission + Operator Delivery',
  on_attempt: 'On Attempt', on_accepted: 'On Accepted',
};

// Distinct billing-mode pill colors so modes read differently at a glance.
const BILLING_MODE_STYLES: Record<string, string> = {
  on_submission: 'background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;',
  on_delivery: 'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;',
  submission_delivery: 'background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;',
  operator_submission: 'background:#fffbeb;color:#b45309;border:1px solid #fde68a;',
  operator_delivery: 'background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;',
  hybrid: 'background:#fdf2f8;color:#be185d;border:1px solid #f9a8d4;',
  on_attempt: 'background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;',
  on_accepted: 'background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4;',
};

export function buildEmailHtml(args: {
  validFrom: Date; systemId: string; attachmentFilename?: string | null;
  rates: Array<{ country: string; network_name: string; mcc: string; mnc: string; currency: string; rate: string; billing_mode?: string; delivery_rate?: string | null }>;
}): string {
  const rows = args.rates.map((r) => {
    const sym = r.currency === 'EUR' ? '€' : '$';
    const bmKey = String(r.billing_mode ?? 'on_submission');
    const bm = BILLING_MODE_LABELS[bmKey] ?? 'On Submission';
    const bmStyle = BILLING_MODE_STYLES[bmKey] ?? BILLING_MODE_STYLES.on_submission;
    const rateCell = r.delivery_rate !== null && r.delivery_rate !== undefined && String(r.delivery_rate) !== ''
      ? `${sym}${esc(Number(r.rate).toFixed(3))} + ${sym}${esc(Number(r.delivery_rate).toFixed(3))} ${esc(r.currency)}`
      : `${sym}${esc(Number(r.rate).toFixed(3))} ${esc(r.currency)}`;
    return `<tr>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;">${esc(r.country)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;">${esc(r.network_name)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:center;">${esc(r.mcc)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:center;">${esc(r.mnc)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;white-space:nowrap;">${rateCell}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;"><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;${bmStyle}">${esc(bm)}</span></td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;color:#ffffff;padding:20px 28px;">
<div style="font-size:20px;font-weight:bold;">8xtel</div>
<div style="font-size:12px;color:#94a3b8;">Rate Notification</div></div>
<div style="padding:28px;color:#1e293b;font-size:14px;line-height:1.6;">
<p>Dear Team,</p>
<p>I hope you're doing well.</p>
<p>Please find the rate notification below. It is valid from<br><strong>${esc(fmtValidFrom(args.validFrom))}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
<thead><tr style="background:#0f172a;color:#ffffff;">
<th style="padding:10px 12px;border:1px solid #0f172a;text-align:left;">Country</th>
<th style="padding:10px 12px;border:1px solid #0f172a;text-align:left;">Network</th>
<th style="padding:10px 12px;border:1px solid #0f172a;">MCC</th>
<th style="padding:10px 12px;border:1px solid #0f172a;">MNC</th>
<th style="padding:10px 12px;border:1px solid #0f172a;text-align:right;">Price, Currency</th>
<th style="padding:10px 12px;border:1px solid #0f172a;text-align:left;">Billing Mode</th>
</tr></thead><tbody>${rows}</tbody></table>
${args.attachmentFilename ? `<p>The complete current rate list for your account is attached as an Excel file.<br>Attachment: <strong>${esc(args.attachmentFilename)}</strong></p>` : ''}
<p>It is set on: <strong>${esc(args.systemId)}</strong></p>
<p style="font-size:12px;color:#64748b;"><strong>Note</strong> - SMS sent to any destination not included in this price list will be charged according to the applicable default rate.</p>
<p>Regards,<br><strong>8xtel</strong></p>
</div>
<div style="background:#f8fafc;padding:12px 28px;font-size:11px;color:#94a3b8;">This is an automated rate notification from 8xtel. Please reply to ${esc(SENDER_EMAIL)} with any questions.</div>
</div></body></html>`;
}

/** Validate + dedupe TO/CC/BCC. Returns error string or normalized lists. */
function validateRecipients(to: string, cc: string[], bcc: string[]): { error?: string; cc?: string[]; bcc?: string[] } {
  const t = norm(to);
  if (!EMAIL_RE.test(t)) return { error: 'primary TO email is invalid' };
  const seen = new Set([t]);
  const clean = (list: string[]): string[] => {
    const out: string[] = [];
    for (const e of list) {
      const v = norm(e);
      if (!EMAIL_RE.test(v)) return [] as unknown as string[];
      if (!seen.has(v)) { seen.add(v); out.push(v); }
    }
    return out;
  };
  const ccClean = clean(cc);
  if (ccClean.length !== new Set(cc.map(norm)).size || cc.some((e) => !EMAIL_RE.test(norm(e)))) {
    // distinguish invalid vs duplicate-with-TO
    for (const e of cc) {
      const v = norm(e);
      if (!EMAIL_RE.test(v)) return { error: `invalid CC email: ${e}` };
      if (v === t) return { error: `TO email must not appear in CC: ${e}` };
    }
  }
  const bccClean = clean(bcc);
  for (const e of bcc) {
    const v = norm(e);
    if (!EMAIL_RE.test(v)) return { error: `invalid BCC email: ${e}` };
    if (v === t) return { error: `TO email must not appear in BCC: ${e}` };
  }
  const ccSet = new Set(ccClean);
  for (const v of bccClean) {
    if (ccSet.has(v)) return { error: `email must not be in both CC and BCC: ${v}` };
  }
  return { cc: ccClean, bcc: bccClean };
}

async function autoSaveContacts(emails: string[], actorId: string | null): Promise<void> {
  for (const email of emails) {
    const name = email.split('@')[0]!.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    await getPool().query(
      `INSERT INTO rate_notification_email_contacts (display_name, email, created_by)
       VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET last_used_at=now(), updated_at=now()`,
      [name, email, actorId],
    );
  }
}

async function storeRecipients(rnId: string, to: string, cc: string[], bcc: string[]): Promise<void> {
  const pool = getPool();
  const rows: Array<[string, string, string]> = [
    [rnId, to, 'TO'],
    ...cc.map((e): [string, string, string] => [rnId, e, 'CC']),
    ...bcc.map((e): [string, string, string] => [rnId, e, 'BCC']),
  ];
  for (const [id, email, type] of rows) {
    await pool.query(
      'INSERT INTO rate_notification_recipients (rate_notification_id, email, recipient_type) VALUES ($1,$2,$3)',
      [id, email, type],
    );
  }
}

async function recipientsFor(rnId: string): Promise<{ to: string[]; cc: string[]; bcc: string[] }> {
  const rows = await query<{ email: string; recipient_type: string }>(
    'SELECT email, recipient_type FROM rate_notification_recipients WHERE rate_notification_id=$1 ORDER BY created_at',
    [rnId],
  );
  return {
    to: rows.filter((r) => r.recipient_type === 'TO').map((r) => r.email),
    cc: rows.filter((r) => r.recipient_type === 'CC').map((r) => r.email),
    bcc: rows.filter((r) => r.recipient_type === 'BCC').map((r) => r.email),
  };
}

// ── Client lookup for the searchable dropdown ────────────────────────────────
router.get('/clients', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const params: unknown[] = [];
  let where = `COALESCE(c.is_house,false)=false`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (c.name ILIKE $1 OR c.company_name ILIKE $1 OR c.system_id ILIKE $1 OR c.portal_email ILIKE $1 OR c.rate_email ILIKE $1)`;
  }
  const rows = await query<{
    id: string; name: string; company_name: string | null; system_id: string;
    portal_email: string | null; rate_email: string | null; status: string;
  }>(
    `SELECT c.id, c.name, c.company_name, c.system_id, c.portal_email, c.rate_email, c.status
     FROM clients c WHERE ${where} ORDER BY c.name LIMIT 30`,
    params,
  );
  res.json({
    clients: rows.map((c) => ({
      id: c.id,
      name: c.name,
      company_name: c.company_name,
      account_id: c.system_id,
      system_id: c.system_id,
      email: c.rate_email ?? c.portal_email,
      portal_email: c.portal_email,
      rate_email: c.rate_email,
      status: c.status,
    })),
  });
});

// ── Set / update a client's rate-notification email ──────────────────────────
router.patch('/clients/:clientId/rate-email', audit('set_client_rate_email', 'client'), async (req, res) => {
  const parsed = z.object({ rate_email: z.string().email().max(254).nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const r = await getPool().query(
    'UPDATE clients SET rate_email=$1, updated_at=now() WHERE id=$2 RETURNING id, rate_email',
    [parsed.data.rate_email?.toLowerCase() ?? null, req.params.clientId],
  );
  if (!r.rowCount) { res.status(404).json({ error: 'client not found' }); return; }
  res.json({ id: r.rows[0].id, rate_email: r.rows[0].rate_email });
});

// ── Saved email contacts ─────────────────────────────────────────────────────
router.get('/contacts', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const params: unknown[] = [];
  let where = 'active=true';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (display_name ILIKE $1 OR email ILIKE $1)`;
  }
  const rows = await query<{
    id: string; display_name: string; email: string;
    is_default_cc: boolean; is_default_bcc: boolean; last_used_at: string | null;
  }>(
    `SELECT id, display_name, email, is_default_cc, is_default_bcc, last_used_at
     FROM rate_notification_email_contacts WHERE ${where}
     ORDER BY last_used_at DESC NULLS LAST, display_name LIMIT 50`,
    params,
  );
  res.json({ contacts: rows });
});

router.get('/contacts/defaults', async (_req, res) => {
  const rows = await query<{ id: string; display_name: string; email: string; is_default_cc: boolean; is_default_bcc: boolean }>(
    `SELECT id, display_name, email, is_default_cc, is_default_bcc
     FROM rate_notification_email_contacts WHERE active=true AND (is_default_cc OR is_default_bcc)
     ORDER BY display_name`,
  );
  res.json({
    default_cc: rows.filter((r) => r.is_default_cc),
    default_bcc: rows.filter((r) => r.is_default_bcc),
  });
});

router.post('/contacts', audit('created_rn_contact', 'rn_contact'), async (req, res) => {
  const parsed = z.object({
    display_name: z.string().min(1).max(120),
    email: z.string().email().max(254),
    is_default_cc: z.boolean().optional(),
    is_default_bcc: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const actor = (req as unknown as { user?: { id?: string } }).user;
  try {
    const { rows } = await getPool().query(
      `INSERT INTO rate_notification_email_contacts (display_name, email, is_default_cc, is_default_bcc, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name,
         is_default_cc=EXCLUDED.is_default_cc, is_default_bcc=EXCLUDED.is_default_bcc, updated_at=now()
       RETURNING id, display_name, email, is_default_cc, is_default_bcc`,
      [parsed.data.display_name.trim(), norm(parsed.data.email),
       parsed.data.is_default_cc ?? false, parsed.data.is_default_bcc ?? false,
       actor?.id ?? null],
    );
    res.status(201).json({ contact: rows[0] });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message.slice(0, 200) });
  }
});

router.patch('/contacts/:id', audit('updated_rn_contact', 'rn_contact'), async (req, res) => {
  const parsed = z.object({
    display_name: z.string().min(1).max(120).optional(),
    is_default_cc: z.boolean().optional(),
    is_default_bcc: z.boolean().optional(),
    active: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const sets: string[] = ['updated_at=now()'];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    sets.push(`${k}=$${i++}`);
    vals.push(typeof v === 'string' ? v.trim() : v);
  }
  if (vals.length === 0) { res.status(400).json({ error: 'nothing to update' }); return; }
  vals.push(req.params.id);
  const { rows } = await getPool().query(
    `UPDATE rate_notification_email_contacts SET ${sets.join(', ')} WHERE id=$${i} RETURNING id, display_name, email, is_default_cc, is_default_bcc, active`,
    vals,
  );
  if (!rows.length) { res.status(404).json({ error: 'contact not found' }); return; }
  res.json({ contact: rows[0] });
});

router.delete('/contacts/:id', audit('deleted_rn_contact', 'rn_contact'), async (req, res) => {
  const r = await getPool().query(
    'UPDATE rate_notification_email_contacts SET active=false, updated_at=now() WHERE id=$1', [req.params.id],
  );
  if (!r.rowCount) { res.status(404).json({ error: 'contact not found' }); return; }
  res.json({ ok: true });
});

// ── Saved rate card for a client (prefills the create form) ──────────────────
router.get('/saved-rates/:clientId', async (req, res) => {
  const rows = await query<{
    id: string; country: string; country_code: string | null; network_name: string;
    mcc: string; mnc: string; currency: string; rate: string;
    billing_mode: string; delivery_rate: string | null; updated_at: string;
  }>(
    `SELECT id, country, country_code, network_name, mcc, mnc, currency, rate,
            billing_mode, delivery_rate, updated_at
     FROM client_saved_rates WHERE client_id=$1 ORDER BY country, network_name`,
    [req.params.clientId],
  );
  res.json({ rates: rows });
});

// ── Add / update one saved rate ──────────────────────────────────────────────
const savedRateSchema = z.object({
  country: z.string().min(1).max(100),
  country_code: z.string().length(2).nullable().optional(),
  network_name: z.string().min(1).max(120),
  mcc: z.string().regex(/^\d{3}$/),
  mnc: z.string().regex(/^(\d{1,3}|ALL)$/i),
  currency: z.enum(['EUR', 'USD']),
  rate: z.number().positive().max(999999),
  billing_mode: z.enum(BILLING_MODE_VALUES).default('on_submission'),
  delivery_rate: z.number().positive().max(999999).nullable().optional(),
});

router.post('/saved-rates/:clientId', audit('saved_client_rate', 'client_saved_rate'), async (req, res) => {
  const parsed = savedRateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const client = await queryOne<{ id: string }>('SELECT id FROM clients WHERE id=$1', [req.params.clientId]);
  if (!client) { res.status(404).json({ error: 'client not found' }); return; }
  const r = parsed.data;
  const { rows } = await getPool().query(
    `INSERT INTO client_saved_rates
       (client_id, country, country_code, network_name, mcc, mnc, currency, rate, billing_mode, delivery_rate, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (client_id, country, network_name, mcc, mnc, currency)
     DO UPDATE SET country_code=EXCLUDED.country_code, rate=EXCLUDED.rate,
       billing_mode=EXCLUDED.billing_mode, delivery_rate=EXCLUDED.delivery_rate, updated_at=now()
     RETURNING id`,
    [req.params.clientId, r.country, r.country_code ?? null, r.network_name,
     r.mcc, r.mnc.toUpperCase(), r.currency, r.rate, r.billing_mode,
     r.delivery_rate ?? null],
  );
  res.status(201).json({ id: rows[0].id });
});

// ── Remove one saved rate ────────────────────────────────────────────────────
router.delete('/saved-rates/:clientId/:rateId', audit('deleted_client_rate', 'client_saved_rate'), async (req, res) => {
  const r = await getPool().query(
    'DELETE FROM client_saved_rates WHERE id=$2 AND client_id=$1', [req.params.clientId, req.params.rateId],
  );
  if (!r.rowCount) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ ok: true });
});

// ── Countries for the destination picker ─────────────────────────────────────
router.get('/countries', async (_req, res) => {
  const rows = await query<{ name: string; iso_code: string; calling_code: string }>(
    `SELECT name, iso_code, calling_code FROM countries WHERE status='active' ORDER BY name`,
  );
  const { mccsForIso } = await import('@8xtel/core');
  res.json({
    countries: rows.map((c) => ({
      ...c,
      mccs: (mccsForIso as (iso: string) => string[])(c.iso_code),
    })),
  });
});

// ── Stats for summary cards ──────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  const r = await queryOne<{ total: string; sent: string; failed: string; drafts: string; month: string }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status='sent') AS sent,
            COUNT(*) FILTER (WHERE status='failed') AS failed,
            COUNT(*) FILTER (WHERE status IN ('draft','sending')) AS drafts,
            COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS month
     FROM rate_notifications`,
  );
  res.json({
    total: Number(r?.total ?? 0), sent: Number(r?.sent ?? 0),
    failed: Number(r?.failed ?? 0), drafts: Number(r?.drafts ?? 0),
    month: Number(r?.month ?? 0),
  });
});

// ── Preview (no DB write, no send) ───────────────────────────────────────────
router.post('/preview', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const client = await queryOne<{ name: string; system_id: string; portal_email: string | null; rate_email: string | null }>(
    'SELECT name, system_id, portal_email, rate_email FROM clients WHERE id=$1', [parsed.data.client_id],
  );
  if (!client) { res.status(404).json({ error: 'client not found' }); return; }
  const to = client.rate_email ?? client.portal_email;
  if (!to) { res.status(422).json({ error: 'client has no rates email on file — set "Send mail to" first' }); return; }
  const v = validateRecipients(to, parsed.data.cc, parsed.data.bcc);
  if (v.error) { res.status(422).json({ error: v.error }); return; }
  const subject = buildSubject(client.system_id, client.system_id);
  const validFrom = new Date(parsed.data.valid_from);
  const filename = attachmentFilename(client.system_id, client.system_id);
  let attachment = null;
  if (parsed.data.include_attachment) {
    try {
      const list = await getClientActiveRates(parsed.data.client_id, validFrom);
      attachment = { filename, route_count: list.rows.length, countries: list.countries, networks: list.networks, currency: list.currency, empty: list.rows.length === 0 };
    } catch (e) { attachment = { filename, error: (e as Error).message.slice(0, 200), empty: true, route_count: 0, countries: 0, networks: 0, currency: '' }; }
  }
  const html = buildEmailHtml({
    validFrom,
    systemId: client.system_id,
    attachmentFilename: parsed.data.include_attachment ? filename : null,
    rates: parsed.data.rates.map((r) => ({
      ...r, rate: String(r.rate),
      delivery_rate: r.delivery_rate !== null && r.delivery_rate !== undefined ? String(r.delivery_rate) : null,
    })),
  });
  res.json({
    to: norm(to), cc: v.cc, bcc: v.bcc, attachment,
    from: SENDER_EMAIL,
    from_name: SENDER_NAME,
    subject,
    valid_from_display: fmtValidFrom(validFrom),
    html,
  });
});

// ── Create + send ────────────────────────────────────────────────────────────
router.post('/', audit('sent_rate_notification', 'rate_notification'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const client = await queryOne<{ name: string; system_id: string; portal_email: string | null; rate_email: string | null }>(
    'SELECT name, system_id, portal_email, rate_email FROM clients WHERE id=$1', [parsed.data.client_id],
  );
  if (!client) { res.status(404).json({ error: 'client not found' }); return; }
  const rawTo = client.rate_email ?? client.portal_email;
  if (!rawTo || !EMAIL_RE.test(norm(rawTo))) {
    res.status(422).json({ error: 'client has no valid rates email — set "Send mail to" first' });
    return;
  }
  const to = norm(rawTo);
  const v = validateRecipients(to, parsed.data.cc, parsed.data.bcc);
  if (v.error) { res.status(422).json({ error: v.error }); return; }
  const cc = v.cc ?? [];
  const bcc = v.bcc ?? [];
  const pool = getPool();
  const subject = buildSubject(client.system_id, client.system_id);
  const validFrom = new Date(parsed.data.valid_from);
  if (Number.isNaN(validFrom.getTime())) { res.status(400).json({ error: 'invalid valid_from' }); return; }
  for (let i = 0; i < parsed.data.rates.length; i++) {
    const r = parsed.data.rates[i];
    if ((r.billing_mode === 'submission_delivery' || r.billing_mode === 'hybrid') &&
        (r.delivery_rate === null || r.delivery_rate === undefined)) {
      res.status(422).json({ error: `destination ${i + 1}: ${r.billing_mode} needs a delivery rate` });
      return;
    }
  }
  const filename = attachmentFilename(client.system_id, client.system_id);
  // Generate the client's COMPLETE active rate list BEFORE the insert, so a
  // failure blocks the send (email is only sent after the file exists).
  let xlsx: Buffer | null = null;
  let rateList: { rows: unknown[]; currency: string; countries: number; networks: number } | null = null;
  if (parsed.data.include_attachment) {
    try {
      const list = await getClientActiveRates(parsed.data.client_id, validFrom);
      rateList = list;
      if (!list.rows.length) {
        res.status(422).json({ error: 'No active rates found for this client account. Verify the route/rate configuration before sending.' });
        return;
      }
      const full = await queryOne<{ name: string; company_name: string | null }>('SELECT name, company_name FROM clients WHERE id=$1', [parsed.data.client_id]);
      xlsx = await buildClientRatesXlsx({
        clientName: full?.company_name ?? full?.name ?? client.name,
        productName: client.system_id, accountId: client.system_id, systemId: client.system_id,
        currency: list.currency, timezone: parsed.data.timezone, list,
      });
    } catch (e) {
      res.status(502).json({ error: 'attachment generation failed: ' + (e as Error).message.slice(0, 200) });
      return;
    }
  }
  const html = buildEmailHtml({
    validFrom,
    systemId: client.system_id,
    attachmentFilename: xlsx ? filename : null,
    rates: parsed.data.rates.map((r) => ({
      ...r, rate: String(r.rate),
      delivery_rate: r.delivery_rate !== null && r.delivery_rate !== undefined ? String(r.delivery_rate) : null,
    })),
  });
  const actor = (req as unknown as { user?: { id?: string; email?: string } }).user;
  const { rows } = await pool.query(
    `INSERT INTO rate_notifications
       (client_id, account_id, system_id, recipient_email, sender_email, subject,
        valid_from, timezone, status, created_by, created_by_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sending',$9,$10) RETURNING id`,
    [parsed.data.client_id, client.system_id, client.system_id, to,
     SENDER_EMAIL, subject, validFrom.toISOString(), parsed.data.timezone,
     actor?.id ?? null, actor?.email ?? null],
  );
  const rnId: string = rows[0].id;
  await storeRecipients(rnId, to, cc, bcc);
  if (xlsx && rateList) {
    await pool.query(
      'INSERT INTO rate_notification_attachments (rate_notification_id, filename, content, route_count, country_count, network_count, currency) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (rate_notification_id) DO UPDATE SET filename=EXCLUDED.filename, content=EXCLUDED.content, route_count=EXCLUDED.route_count, country_count=EXCLUDED.country_count, network_count=EXCLUDED.network_count, currency=EXCLUDED.currency',
      [rnId, filename, xlsx, rateList.rows.length, rateList.countries, rateList.networks, rateList.currency],
    );
    await pool.query('UPDATE rate_notifications SET attachment_filename=$1, attachment_route_count=$2 WHERE id=$3', [filename, rateList.rows.length, rnId]);
  }
  // Auto-save new CC/BCC contacts + touch last_used for existing ones.
  await autoSaveContacts([...cc, ...bcc], actor?.id ?? null);
  for (const r of parsed.data.rates) {
    await pool.query(
      `INSERT INTO rate_notification_rates
         (rate_notification_id, country, country_code, network_name, mcc, mnc, currency, rate, billing_mode, delivery_rate, valid_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [rnId, r.country, r.country_code ?? null, r.network_name, r.mcc,
       r.mnc.toUpperCase(), r.currency, r.rate, r.billing_mode,
       r.delivery_rate ?? null, validFrom.toISOString()],
    );
    await pool.query(
      `INSERT INTO client_saved_rates
         (client_id, country, country_code, network_name, mcc, mnc, currency, rate, billing_mode, delivery_rate, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (client_id, country, network_name, mcc, mnc, currency)
       DO UPDATE SET country_code=EXCLUDED.country_code, rate=EXCLUDED.rate,
         billing_mode=EXCLUDED.billing_mode, delivery_rate=EXCLUDED.delivery_rate, updated_at=now()`,
      [parsed.data.client_id, r.country, r.country_code ?? null, r.network_name,
       r.mcc, r.mnc.toUpperCase(), r.currency, r.rate, r.billing_mode,
       r.delivery_rate ?? null],
    );
  }
  try {
    await sendRnMail({ to, cc, bcc, subject, html, attachments: xlsx ? [{ filename, content: xlsx }] : [] });
    await pool.query(
      `UPDATE rate_notifications SET status='sent', sent_at=now() WHERE id=$1`, [rnId],
    );
    res.status(201).json({ id: rnId, status: 'sent', subject, to, cc, bcc, recipient_count: 1 + cc.length + bcc.length, dest_count: parsed.data.rates.length, attachment: xlsx ? { filename, route_count: rateList!.rows.length, countries: rateList!.countries, networks: rateList!.networks, currency: rateList!.currency } : null });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await pool.query(
      `UPDATE rate_notifications SET status='failed', error_message=$1 WHERE id=$2`, [msg, rnId],
    );
    res.status(502).json({ id: rnId, status: 'failed', error: msg });
  }
});

// ── History list with filters ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (q.from) { conds.push(`rn.created_at >= $${i++}`); params.push(q.from); }
  if (q.to) { conds.push(`rn.created_at <= $${i++}`); params.push(q.to); }
  if (q.client) { conds.push(`c.name ILIKE $${i++}`); params.push(`%${q.client}%`); }
  if (q.account_id) { conds.push(`rn.account_id ILIKE $${i++}`); params.push(`%${q.account_id}%`); }
  if (q.system_id) { conds.push(`rn.system_id ILIKE $${i++}`); params.push(`%${q.system_id}%`); }
  if (q.status) { conds.push(`rn.status = $${i++}`); params.push(q.status); }
  if (q.currency) { conds.push(`EXISTS (SELECT 1 FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id AND r.currency=$${i++})`); params.push(q.currency); }
  if (q.billing_mode) { conds.push(`EXISTS (SELECT 1 FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id AND r.billing_mode=$${i++})`); params.push(q.billing_mode); }
  if (q.country) { conds.push(`EXISTS (SELECT 1 FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id AND r.country ILIKE $${i++})`); params.push(`%${q.country}%`); }
  if (q.sent_by) { conds.push(`rn.created_by_email ILIKE $${i++}`); params.push(`%${q.sent_by}%`); }
  if (q.search) {
    conds.push(`(c.name ILIKE $${i} OR rn.account_id ILIKE $${i} OR rn.system_id ILIKE $${i} OR rn.subject ILIKE $${i} OR rn.recipient_email ILIKE $${i})`);
    params.push(`%${q.search}%`); i++;
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await query<{
    id: string; client_name: string; account_id: string; system_id: string;
    recipient_email: string; subject: string; valid_from: string; status: string;
    created_by_email: string | null; created_at: string; sent_at: string | null;
    dest_count: string; currencies: string[] | null; billing_modes: string[] | null;
    to_list: string[] | null; cc_list: string[] | null; bcc_list: string[] | null;
  }>(
    `SELECT rn.id, c.name AS client_name, rn.account_id, rn.system_id,
            rn.recipient_email, rn.subject, rn.valid_from, rn.status,
            rn.created_by_email, rn.created_at, rn.sent_at,
            (SELECT COUNT(*) FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id) AS dest_count,
            (SELECT array_agg(DISTINCT r.currency) FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id) AS currencies,
            (SELECT array_agg(DISTINCT r.billing_mode) FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id) AS billing_modes,
            (SELECT array_agg(rr.email) FROM rate_notification_recipients rr WHERE rr.rate_notification_id=rn.id AND rr.recipient_type='TO') AS to_list,
            (SELECT array_agg(rr.email) FROM rate_notification_recipients rr WHERE rr.rate_notification_id=rn.id AND rr.recipient_type='CC') AS cc_list,
            (SELECT array_agg(rr.email) FROM rate_notification_recipients rr WHERE rr.rate_notification_id=rn.id AND rr.recipient_type='BCC') AS bcc_list,
            (SELECT a.filename FROM rate_notification_attachments a WHERE a.rate_notification_id=rn.id) AS attachment_filename,
            (SELECT a.route_count FROM rate_notification_attachments a WHERE a.rate_notification_id=rn.id) AS attachment_routes
     FROM rate_notifications rn JOIN clients c ON c.id=rn.client_id
     ${where}
     ORDER BY rn.created_at DESC LIMIT 500`,
    params,
  );
  res.json({ notifications: rows });
});

// ── Export (respects same filters) ───────────────────────────────────────────
router.get('/export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const format = q.format === 'xls' ? 'xls' : 'csv';
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (q.from) { conds.push(`rn.created_at >= $${i++}`); params.push(q.from); }
  if (q.to) { conds.push(`rn.created_at <= $${i++}`); params.push(q.to); }
  if (q.client) { conds.push(`c.name ILIKE $${i++}`); params.push(`%${q.client}%`); }
  if (q.account_id) { conds.push(`rn.account_id ILIKE $${i++}`); params.push(`%${q.account_id}%`); }
  if (q.system_id) { conds.push(`rn.system_id ILIKE $${i++}`); params.push(`%${q.system_id}%`); }
  if (q.status) { conds.push(`rn.status = $${i++}`); params.push(q.status); }
  if (q.currency) { conds.push(`EXISTS (SELECT 1 FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id AND r.currency=$${i++})`); params.push(q.currency); }
  if (q.billing_mode) { conds.push(`EXISTS (SELECT 1 FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id AND r.billing_mode=$${i++})`); params.push(q.billing_mode); }
  if (q.country) { conds.push(`EXISTS (SELECT 1 FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id AND r.country ILIKE $${i++})`); params.push(`%${q.country}%`); }
  if (q.sent_by) { conds.push(`rn.created_by_email ILIKE $${i++}`); params.push(`%${q.sent_by}%`); }
  if (q.search) {
    conds.push(`(c.name ILIKE $${i} OR rn.account_id ILIKE $${i} OR rn.system_id ILIKE $${i} OR rn.subject ILIKE $${i})`);
    params.push(`%${q.search}%`); i++;
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await query<Record<string, unknown>>(
    `SELECT rn.id, rn.created_at, c.name AS client, rn.account_id, rn.system_id,
            (SELECT string_agg(rr.email, '; ') FROM rate_notification_recipients rr WHERE rr.rate_notification_id=rn.id AND rr.recipient_type='TO') AS to_emails,
            (SELECT string_agg(rr.email, '; ') FROM rate_notification_recipients rr WHERE rr.rate_notification_id=rn.id AND rr.recipient_type='CC') AS cc_emails,
            (SELECT string_agg(rr.email, '; ') FROM rate_notification_recipients rr WHERE rr.rate_notification_id=rn.id AND rr.recipient_type='BCC') AS bcc_emails,
            r.country, r.network_name, r.mcc, r.mnc, r.currency, r.rate, r.billing_mode,
            rn.status, rn.created_by_email, rn.sent_at
     FROM rate_notifications rn
     JOIN clients c ON c.id=rn.client_id
     LEFT JOIN rate_notification_rates r ON r.rate_notification_id=rn.id
     ${where}
     ORDER BY rn.created_at DESC LIMIT 5000`,
    params,
  );
  const cols = ['Notification ID', 'Date', 'Client', 'Account ID', 'System ID', 'TO', 'CC', 'BCC', 'Country', 'Network', 'MCC', 'MNC', 'Currency', 'Rate', 'Billing Mode', 'Status', 'Sent By', 'Sent At'];
  const cell = (v: unknown): string[] => [String(v ?? '')];
  if (format === 'xls') {
    res.setHeader('content-type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="rate-notifications.xls"');
    const h = (v: unknown): string => esc(v);
    res.write(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${cols.map((c) => `<th>${h(c)}</th>`).join('')}</tr>`);
    for (const r of rows) {
      res.write(`<tr>${cell(r.id).concat(cell(r.created_at), cell(r.client), cell(r.account_id), cell(r.system_id), cell(r.to_emails), cell(r.cc_emails), cell(r.bcc_emails), cell(r.country), cell(r.network_name), cell(r.mcc), cell(r.mnc), cell(r.currency), cell(r.rate), cell(BILLING_MODE_LABELS[String(r.billing_mode ?? 'on_submission')] ?? r.billing_mode), cell(r.status), cell(r.created_by_email), cell(r.sent_at)).map((v) => `<td>${h(v)}</td>`).join('')}</tr>`);
    }
    res.write('</table></body></html>');
    res.end();
    return;
  }
  const csvEsc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="rate-notifications.csv"');
  res.write(`${cols.join(',')}\n`);
  for (const r of rows) {
    res.write([r.id, r.created_at, r.client, r.account_id, r.system_id, r.to_emails, r.cc_emails, r.bcc_emails, r.country, r.network_name, r.mcc, r.mnc, r.currency, r.rate, BILLING_MODE_LABELS[String(r.billing_mode ?? 'on_submission')] ?? r.billing_mode, r.status, r.created_by_email, r.sent_at].map(csvEsc).join(',') + '\n');
  }
  res.end();
});

// ── Detail + email preview ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const rn = await queryOne<{
    id: string; client_id: string; client_name: string; account_id: string; system_id: string;
    recipient_email: string; sender_email: string; subject: string; valid_from: string;
    timezone: string; status: string; created_by_email: string | null;
    created_at: string; sent_at: string | null; error_message: string | null;
  }>(
    `SELECT rn.*, c.name AS client_name FROM rate_notifications rn
     JOIN clients c ON c.id=rn.client_id WHERE rn.id=$1`, [req.params.id],
  );
  if (!rn) { res.status(404).json({ error: 'not found' }); return; }
  const rates = await query<{
    country: string; country_code: string | null; network_name: string;
    mcc: string; mnc: string; currency: string; rate: string;
    billing_mode: string; delivery_rate: string | null;
  }>(
    `SELECT country, country_code, network_name, mcc, mnc, currency, rate,
            billing_mode, delivery_rate
     FROM rate_notification_rates WHERE rate_notification_id=$1 ORDER BY country, network_name`,
    [rn.id],
  );
  const recipients = await recipientsFor(rn.id);
  const att = await queryOne<{ filename: string; route_count: number; country_count: number; network_count: number; currency: string | null }>(
    'SELECT filename, route_count, country_count, network_count, currency FROM rate_notification_attachments WHERE rate_notification_id=$1', [rn.id],
  ).catch(() => null);
  const html = buildEmailHtml({ validFrom: new Date(rn.valid_from), systemId: rn.system_id, attachmentFilename: att?.filename ?? null, rates });
  res.json({ notification: rn, rates, recipients, attachment: att, html });
});

// ── Resend using stored data + stored recipients ─────────────────────────────
router.post('/:id/resend', audit('resent_rate_notification', 'rate_notification'), async (req, res) => {
  const rn = await queryOne<{ id: string; subject: string; valid_from: string; system_id: string; status: string }>(
    'SELECT id, subject, valid_from, system_id, status FROM rate_notifications WHERE id=$1',
    [req.params.id],
  );
  if (!rn) { res.status(404).json({ error: 'not found' }); return; }
  const full = await queryOne<{ client_id: string; account_id: string; timezone: string }>(
    'SELECT client_id, account_id, timezone FROM rate_notifications WHERE id=$1', [rn.id],
  );
  const recipients = await recipientsFor(rn.id);
  if (!recipients.to.length) { res.status(422).json({ error: 'no stored recipients' }); return; }
  const rates = await query<{ country: string; network_name: string; mcc: string; mnc: string; currency: string; rate: string; billing_mode: string; delivery_rate: string | null }>(
    `SELECT country, network_name, mcc, mnc, currency, rate, billing_mode, delivery_rate
     FROM rate_notification_rates WHERE rate_notification_id=$1 ORDER BY country, network_name`,
    [rn.id],
  );
  const pool = getPool();
  // mode=original (default): reuse the exact stored xlsx. mode=regenerate:
  // rebuild from the client's CURRENT active rates and replace the snapshot.
  const mode = String(req.query.mode ?? 'original').toLowerCase() === 'regenerate' ? 'regenerate' : 'original';
  let attach = await queryOne<{ filename: string; content: Buffer }>(
    'SELECT filename, content FROM rate_notification_attachments WHERE rate_notification_id=$1', [rn.id],
  ).catch(() => null);
  if (mode === 'regenerate') {
    try {
      const list = await getClientActiveRates(full!.client_id, new Date(rn.valid_from));
      if (!list.rows.length) { res.status(422).json({ error: 'No active rates found for this client account.' }); return; }
      const filename = attachmentFilename(full!.account_id, rn.system_id);
      const info = await queryOne<{ name: string; company_name: string | null }>('SELECT name, company_name FROM clients WHERE id=$1', [full!.client_id]);
      const xlsx = await buildClientRatesXlsx({
        clientName: info?.company_name ?? info?.name ?? '', productName: rn.system_id,
        accountId: full!.account_id, systemId: rn.system_id,
        currency: list.currency, timezone: full!.timezone ?? 'GMT', list,
      });
      await pool.query(
        'INSERT INTO rate_notification_attachments (rate_notification_id, filename, content, route_count, country_count, network_count, currency) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (rate_notification_id) DO UPDATE SET filename=EXCLUDED.filename, content=EXCLUDED.content, route_count=EXCLUDED.route_count, country_count=EXCLUDED.country_count, network_count=EXCLUDED.network_count, currency=EXCLUDED.currency',
        [rn.id, filename, xlsx, list.rows.length, list.countries, list.networks, list.currency],
      );
      await pool.query('UPDATE rate_notifications SET attachment_filename=$1, attachment_route_count=$2 WHERE id=$3', [filename, list.rows.length, rn.id]);
      attach = { filename, content: xlsx };
    } catch (e) {
      res.status(502).json({ error: 'attachment regeneration failed: ' + (e as Error).message.slice(0, 200) });
      return;
    }
  }
  await pool.query(`UPDATE rate_notifications SET status='sending', error_message=NULL WHERE id=$1`, [rn.id]);
  try {
    const html = buildEmailHtml({ validFrom: new Date(rn.valid_from), systemId: rn.system_id, attachmentFilename: attach?.filename ?? null, rates });
    await sendRnMail({ to: recipients.to[0]!, cc: recipients.cc, bcc: recipients.bcc, subject: rn.subject, html, attachments: attach ? [{ filename: attach.filename, content: attach.content }] : [] });
    await pool.query(`UPDATE rate_notifications SET status='sent', sent_at=now() WHERE id=$1`, [rn.id]);
    res.json({ id: rn.id, status: 'sent' });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await pool.query(`UPDATE rate_notifications SET status='failed', error_message=$1 WHERE id=$2`, [msg, rn.id]);
    res.status(502).json({ id: rn.id, status: 'failed', error: msg });
  }
});

// ── Retry failed (alias of resend, kept for backwards compat) ────────────────
router.post('/:id/retry', audit('retried_rate_notification', 'rate_notification'), async (req, res) => {
  const rn = await queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM rate_notifications WHERE id=$1', [req.params.id],
  );
  if (!rn) { res.status(404).json({ error: 'not found' }); return; }
  if (rn.status !== 'failed') { res.status(422).json({ error: `only failed notifications can be retried (status=${rn.status})` }); return; }
  // Forward to resend logic inline
  const full = await queryOne<{ id: string; subject: string; valid_from: string; system_id: string }>(
    'SELECT id, subject, valid_from, system_id FROM rate_notifications WHERE id=$1', [rn.id],
  );
  const recipients = await recipientsFor(rn.id);
  if (!recipients.to.length) { res.status(422).json({ error: 'no stored recipients' }); return; }
  const rates = await query<{ country: string; network_name: string; mcc: string; mnc: string; currency: string; rate: string; billing_mode: string; delivery_rate: string | null }>(
    `SELECT country, network_name, mcc, mnc, currency, rate, billing_mode, delivery_rate
     FROM rate_notification_rates WHERE rate_notification_id=$1 ORDER BY country, network_name`,
    [rn.id],
  );
  const pool = getPool();
  const attach = await queryOne<{ filename: string; content: Buffer }>(
    'SELECT filename, content FROM rate_notification_attachments WHERE rate_notification_id=$1', [rn.id],
  ).catch(() => null);
  await pool.query(`UPDATE rate_notifications SET status='sending', error_message=NULL WHERE id=$1`, [rn.id]);
  try {
    const html = buildEmailHtml({ validFrom: new Date(full!.valid_from), systemId: full!.system_id, attachmentFilename: attach?.filename ?? null, rates });
    await sendRnMail({ to: recipients.to[0]!, cc: recipients.cc, bcc: recipients.bcc, subject: full!.subject, html, attachments: attach ? [{ filename: attach.filename, content: attach.content }] : [] });
    await pool.query(`UPDATE rate_notifications SET status='sent', sent_at=now() WHERE id=$1`, [rn.id]);
    res.json({ id: rn.id, status: 'sent' });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await pool.query(`UPDATE rate_notifications SET status='failed', error_message=$1 WHERE id=$2`, [msg, rn.id]);
    res.status(502).json({ id: rn.id, status: 'failed', error: msg });
  }
});

// ── Download the exact stored xlsx (historical snapshot, never regenerated) ──
router.get('/:id/attachment', async (req, res) => {
  const att = await queryOne<{ filename: string; content: Buffer }>(
    'SELECT filename, content FROM rate_notification_attachments WHERE rate_notification_id=$1', [req.params.id],
  ).catch(() => null);
  if (!att) { res.status(404).json({ error: 'no attachment stored for this notification' }); return; }
  res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition', 'attachment; filename="' + att.filename + '"');
  res.send(att.content);
});

// ── Attachment preview rows (first 25, server-side — browser never loads thousands) ──
router.get('/:id/attachment-preview', async (req, res) => {
  const ExcelJS = (await import('exceljs')).default;
  const att = await queryOne<{ content: Buffer }>(
    'SELECT content FROM rate_notification_attachments WHERE rate_notification_id=$1', [req.params.id],
  ).catch(() => null);
  if (!att) { res.status(404).json({ error: 'no attachment stored' }); return; }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(att.content as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Rates');
  if (!ws) { res.status(404).json({ error: 'rates sheet missing' }); return; }
  const { RN_HEADER_ROW, RN_COLUMNS } = await import('./rate-excel.js');
  const rows = [];
  for (let i = RN_HEADER_ROW + 1; i <= Math.min(ws.rowCount, RN_HEADER_ROW + 25); i++) {
    const v = ws.getRow(i).values as unknown[];
    if (!v || v.length < 2) continue;
    rows.push(Array.isArray(v) ? v.slice(1, 6) : []);
  }
  res.json({ headers: RN_COLUMNS, rows, total: ws.rowCount - RN_HEADER_ROW });
});

// ── Live attachment preview for the create form (server-side rows) ──
router.get('/attachment-preview/:clientId', async (req, res) => {
  try {
    const list = await getClientActiveRates(req.params.clientId);
    res.json({
      filename: attachmentFilename(req.query.account_id ? String(req.query.account_id) : list.currency, req.query.system_id ? String(req.query.system_id) : ''),
      route_count: list.rows.length, countries: list.countries, networks: list.networks,
      currency: list.currency, empty: list.rows.length === 0,
      sample: list.rows.slice(0, 25),
    });
  } catch (e) { res.status(422).json({ error: (e as Error).message.slice(0, 200) }); }
});

// ── Copy notification → new draft ────────────────────────────────────────────
router.post('/:id/copy', audit('copied_rate_notification', 'rate_notification'), async (req, res) => {
  const rn = await queryOne<{ client_id: string; account_id: string; system_id: string; recipient_email: string; subject: string; valid_from: string; timezone: string }>(
    'SELECT client_id, account_id, system_id, recipient_email, subject, valid_from, timezone FROM rate_notifications WHERE id=$1',
    [req.params.id],
  );
  if (!rn) { res.status(404).json({ error: 'not found' }); return; }
  const actor = (req as unknown as { user?: { id?: string; email?: string } }).user;
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO rate_notifications
       (client_id, account_id, system_id, recipient_email, sender_email, subject, valid_from, timezone, status, created_by, created_by_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10) RETURNING id`,
    [rn.client_id, rn.account_id, rn.system_id, rn.recipient_email, SENDER_EMAIL, rn.subject, rn.valid_from, rn.timezone, actor?.id ?? null, actor?.email ?? null],
  );
  const newId: string = rows[0].id;
  await pool.query(
    `INSERT INTO rate_notification_rates
       (rate_notification_id, country, country_code, network_name, mcc, mnc, currency, rate, billing_mode, delivery_rate, valid_from)
     SELECT $1, country, country_code, network_name, mcc, mnc, currency, rate, billing_mode, delivery_rate, valid_from
     FROM rate_notification_rates WHERE rate_notification_id=$2`,
    [newId, req.params.id],
  );
  const recipients = await recipientsFor(req.params.id);
  await storeRecipients(newId, recipients.to[0] ?? rn.recipient_email, recipients.cc, recipients.bcc);
  res.status(201).json({ id: newId, status: 'draft' });
});

// ── Delete notification ──────────────────────────────────────────────────────
router.delete('/:id', audit('deleted_rate_notification', 'rate_notification'), async (req, res) => {
  const r = await getPool().query('DELETE FROM rate_notifications WHERE id=$1', [req.params.id]);
  if (!r.rowCount) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ ok: true });
});

export default router;
