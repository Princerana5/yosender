import { Router } from 'express';
import { z } from 'zod';
import nodemailer, { type Transporter } from 'nodemailer';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
// All RN endpoints need an admin-level permission; reuse clients.update so no
// seed change is required (admins/operations already hold it).
router.use(requirePerm('clients.update'));

const SENDER_NAME = '8xtel Rate Notification';
const SENDER_EMAIL = 'rates@8xtel.com';

// ── Mail sender (env-only credentials, never frontend) ────────────────────────
// Primary: SMTP (RN_SMTP_*). Fallback: Roundcube webmail HTTP on the same
// cPanel host — same mailbox creds, but a different auth path that works even
// when Exim's SMTP AUTH rejects the password (observed live: webmail login OK,
// SMTP 535 on every port/method). RN_MAIL_MODE=roundcube forces the fallback;
// default is smtp → roundcube automatic failover.
async function sendRnMail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const mode = (process.env.RN_MAIL_MODE ?? 'auto').toLowerCase();
  const smtpErr = await trySmtp(opts).catch((e) => e as Error);
  if (!smtpErr) return;
  if (mode === 'smtp') throw smtpErr;
  console.warn(`[rn] smtp failed (${smtpErr.message}) — trying roundcube webmail`);
  await sendViaRoundcube(opts);
  console.log('[rn] sent via roundcube webmail fallback');
}

let transporter: Transporter | null = null;
function trySmtp(opts: { to: string; subject: string; html: string }): Promise<void> {
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
    replyTo: SENDER_EMAIL,
    subject: opts.subject,
    html: opts.html,
  }).then(() => undefined);
}

// Roundcube HTTP send: logs into webmail with the mailbox creds, opens a
// compose window and submits it. Session cookies live only in this call.
async function sendViaRoundcube(opts: { to: string; subject: string; html: string }): Promise<void> {
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
    _to: opts.to, _subject: opts.subject,
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

const rateSchema = z.object({
  country: z.string().min(1).max(100),
  country_code: z.string().length(2).nullable().optional(),
  network_name: z.string().min(1).max(120),
  mcc: z.string().regex(/^\d{3}$/, 'MCC must be 3 digits'),
  mnc: z.string().regex(/^(\d{1,3}|ALL)$/i, 'MNC must be digits or ALL'),
  currency: z.enum(['EUR', 'USD']),
  rate: z.number().positive().max(999999),
});

const createSchema = z.object({
  client_id: z.string().uuid(),
  valid_from: z.string().datetime({ offset: true }),
  timezone: z.string().max(32).default('GMT'),
  rates: z.array(rateSchema).min(1).max(200),
});

export function buildSubject(accountId: string, systemId: string): string {
  return `8xtel Rate notification _${accountId}/${systemId}`;
}

function fmtValidFrom(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} GMT ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} hours`;
}

export function buildEmailHtml(args: {
  validFrom: Date; systemId: string;
  rates: Array<{ country: string; network_name: string; mcc: string; mnc: string; currency: string; rate: string }>;
}): string {
  const rows = args.rates.map((r) => {
    const sym = r.currency === 'EUR' ? '€' : '$';
    return `<tr>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;">${esc(r.country)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;">${esc(r.network_name)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:center;">${esc(r.mcc)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:center;">${esc(r.mnc)}</td>
      <td style="padding:10px 12px;border:1px solid #e2e8f0;text-align:right;white-space:nowrap;">${sym}${esc(Number(r.rate).toFixed(3))} ${esc(r.currency)}</td>
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
</tr></thead><tbody>${rows}</tbody></table>
<p>It is set on: <strong>${esc(args.systemId)}</strong></p>
<p style="font-size:12px;color:#64748b;"><strong>Note</strong> - SMS sent to any destination not included in this price list will be charged according to the applicable default rate.</p>
<p>Regards,<br><strong>8xtel</strong></p>
</div>
<div style="background:#f8fafc;padding:12px 28px;font-size:11px;color:#94a3b8;">This is an automated rate notification from 8xtel. Please reply to ${esc(SENDER_EMAIL)} with any questions.</div>
</div></body></html>`;
}

// ── Client lookup for the searchable dropdown ────────────────────────────────
router.get('/clients', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const params: unknown[] = [];
  let where = `COALESCE(c.is_house,false)=false`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (c.name ILIKE $1 OR c.company_name ILIKE $1 OR c.system_id ILIKE $1 OR c.portal_email ILIKE $1)`;
  }
  const rows = await query<{
    id: string; name: string; company_name: string | null; system_id: string;
    portal_email: string | null; status: string;
  }>(
    `SELECT c.id, c.name, c.company_name, c.system_id, c.portal_email, c.status
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
      email: c.portal_email,
      status: c.status,
    })),
  });
});

// ── Saved rate card for a client (prefills the create form) ──────────────────
router.get('/saved-rates/:clientId', async (req, res) => {
  const rows = await query<{
    id: string; country: string; country_code: string | null; network_name: string;
    mcc: string; mnc: string; currency: string; rate: string; updated_at: string;
  }>(
    `SELECT id, country, country_code, network_name, mcc, mnc, currency, rate, updated_at
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
       (client_id, country, country_code, network_name, mcc, mnc, currency, rate, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (client_id, country, network_name, mcc, mnc, currency)
     DO UPDATE SET country_code=EXCLUDED.country_code, rate=EXCLUDED.rate, updated_at=now()
     RETURNING id`,
    [req.params.clientId, r.country, r.country_code ?? null, r.network_name,
     r.mcc, r.mnc.toUpperCase(), r.currency, r.rate],
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
  res.json({ countries: rows });
});

// ── Preview (no DB write, no send) ───────────────────────────────────────────
router.post('/preview', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const client = await queryOne<{ name: string; system_id: string; portal_email: string | null }>(
    'SELECT name, system_id, portal_email FROM clients WHERE id=$1', [parsed.data.client_id],
  );
  if (!client) { res.status(404).json({ error: 'client not found' }); return; }
  if (!client.portal_email) { res.status(422).json({ error: 'client has no email on file (portal_email)' }); return; }
  const subject = buildSubject(client.system_id, client.system_id);
  const validFrom = new Date(parsed.data.valid_from);
  const html = buildEmailHtml({
    validFrom,
    systemId: client.system_id,
    rates: parsed.data.rates.map((r) => ({ ...r, rate: String(r.rate) })),
  });
  res.json({
    to: client.portal_email,
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
  const client = await queryOne<{ name: string; system_id: string; portal_email: string | null }>(
    'SELECT name, system_id, portal_email FROM clients WHERE id=$1', [parsed.data.client_id],
  );
  if (!client) { res.status(404).json({ error: 'client not found' }); return; }
  if (!client.portal_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(client.portal_email)) {
    res.status(422).json({ error: 'client has no valid email on file (portal_email)' });
    return;
  }
  const pool = getPool();
  const subject = buildSubject(client.system_id, client.system_id);
  const validFrom = new Date(parsed.data.valid_from);
  if (Number.isNaN(validFrom.getTime())) { res.status(400).json({ error: 'invalid valid_from' }); return; }
  const html = buildEmailHtml({
    validFrom,
    systemId: client.system_id,
    rates: parsed.data.rates.map((r) => ({ ...r, rate: String(r.rate) })),
  });
  const actor = (req as unknown as { user?: { id?: string; email?: string } }).user;
  const { rows } = await pool.query(
    `INSERT INTO rate_notifications
       (client_id, account_id, system_id, recipient_email, sender_email, subject,
        valid_from, timezone, status, created_by, created_by_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sending',$9,$10) RETURNING id`,
    [parsed.data.client_id, client.system_id, client.system_id, client.portal_email,
     SENDER_EMAIL, subject, validFrom.toISOString(), parsed.data.timezone,
     actor?.id ?? null, actor?.email ?? null],
  );
  const rnId: string = rows[0].id;
  for (const r of parsed.data.rates) {
    await pool.query(
      `INSERT INTO rate_notification_rates
         (rate_notification_id, country, country_code, network_name, mcc, mnc, currency, rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [rnId, r.country, r.country_code ?? null, r.network_name, r.mcc,
       r.mnc.toUpperCase(), r.currency, r.rate],
    );
    // Auto-save the rate card: next time the admin picks this client the
    // destinations prefill. Upsert on the natural key so re-sends update.
    await pool.query(
      `INSERT INTO client_saved_rates
         (client_id, country, country_code, network_name, mcc, mnc, currency, rate, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (client_id, country, network_name, mcc, mnc, currency)
       DO UPDATE SET country_code=EXCLUDED.country_code, rate=EXCLUDED.rate, updated_at=now()`,
      [parsed.data.client_id, r.country, r.country_code ?? null, r.network_name,
       r.mcc, r.mnc.toUpperCase(), r.currency, r.rate],
    );
  }
  try {
    await sendRnMail({ to: client.portal_email, subject, html });
    await pool.query(
      `UPDATE rate_notifications SET status='sent', sent_at=now() WHERE id=$1`, [rnId],
    );
    res.status(201).json({ id: rnId, status: 'sent', subject });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await pool.query(
      `UPDATE rate_notifications SET status='failed', error_message=$1 WHERE id=$2`, [msg, rnId],
    );
    res.status(502).json({ id: rnId, status: 'failed', error: msg });
  }
});

// ── History list ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const rows = await query<{
    id: string; client_name: string; account_id: string; system_id: string;
    recipient_email: string; subject: string; valid_from: string; status: string;
    created_by_email: string | null; created_at: string; sent_at: string | null;
    dest_count: string;
  }>(
    `SELECT rn.id, c.name AS client_name, rn.account_id, rn.system_id,
            rn.recipient_email, rn.subject, rn.valid_from, rn.status,
            rn.created_by_email, rn.created_at, rn.sent_at,
            (SELECT COUNT(*) FROM rate_notification_rates r WHERE r.rate_notification_id=rn.id) AS dest_count
     FROM rate_notifications rn JOIN clients c ON c.id=rn.client_id
     ORDER BY rn.created_at DESC LIMIT 200`,
  );
  res.json({ notifications: rows });
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
  }>(
    `SELECT country, country_code, network_name, mcc, mnc, currency, rate
     FROM rate_notification_rates WHERE rate_notification_id=$1 ORDER BY country, network_name`,
    [rn.id],
  );
  const html = buildEmailHtml({ validFrom: new Date(rn.valid_from), systemId: rn.system_id, rates });
  res.json({ notification: rn, rates, html });
});

// ── Retry failed ─────────────────────────────────────────────────────────────
router.post('/:id/retry', audit('retried_rate_notification', 'rate_notification'), async (req, res) => {
  const rn = await queryOne<{ id: string; recipient_email: string; subject: string; valid_from: string; system_id: string; status: string }>(
    'SELECT id, recipient_email, subject, valid_from, system_id, status FROM rate_notifications WHERE id=$1',
    [req.params.id],
  );
  if (!rn) { res.status(404).json({ error: 'not found' }); return; }
  if (rn.status !== 'failed') { res.status(422).json({ error: `only failed notifications can be retried (status=${rn.status})` }); return; }
  const rates = await query<{ country: string; network_name: string; mcc: string; mnc: string; currency: string; rate: string }>(
    `SELECT country, network_name, mcc, mnc, currency, rate
     FROM rate_notification_rates WHERE rate_notification_id=$1 ORDER BY country, network_name`,
    [rn.id],
  );
  const pool = getPool();
  await pool.query(`UPDATE rate_notifications SET status='sending', error_message=NULL WHERE id=$1`, [rn.id]);
  try {
    const html = buildEmailHtml({ validFrom: new Date(rn.valid_from), systemId: rn.system_id, rates });
    await sendRnMail({ to: rn.recipient_email, subject: rn.subject, html });
    await pool.query(`UPDATE rate_notifications SET status='sent', sent_at=now() WHERE id=$1`, [rn.id]);
    res.json({ id: rn.id, status: 'sent' });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await pool.query(`UPDATE rate_notifications SET status='failed', error_message=$1 WHERE id=$2`, [msg, rn.id]);
    res.status(502).json({ id: rn.id, status: 'failed', error: msg });
  }
});

export default router;
