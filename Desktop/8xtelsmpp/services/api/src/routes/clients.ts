import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { hashPassword } from '../auth.js';

const router = Router();
router.use(requirePerm('clients.read'));

// ── Portal accounts: clients with portal login (excludes house) ─────────────
router.get('/portal-accounts', async (req, res) => {
  const { q } = req.query as { q?: string };
  const params: unknown[] = [];
  let where = `COALESCE(c.is_house,false)=false AND c.portal_email IS NOT NULL`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (c.name ILIKE $${params.length} OR c.company_name ILIKE $${params.length} OR c.portal_email ILIKE $${params.length} OR c.system_id ILIKE $${params.length})`;
  }
  const rows = await query(
    `SELECT c.*,
            (SELECT count(*) FROM routes r WHERE r.client_id=c.id) AS route_count,
            (SELECT count(*) FROM sender_ids s WHERE s.client_id=c.id AND s.status='approved') AS sender_count
     FROM clients c WHERE ${where} ORDER BY c.created_at DESC LIMIT 200`,
    params,
  );
  res.json({ clients: rows.map((r) => ({ ...(r as object), password_hash: undefined, portal_password_hash: undefined })) });
});

// ── Create portal account in one step: client + wallet + portal login ────────
const portalCreateSchema = z.object({
  name: z.string().min(1),
  company_name: z.string().optional(),
  system_id: z.string().min(3).regex(/^[A-Za-z0-9_.-]+$/),
  portal_email: z.string().email(),
  password: z.string().min(8).optional(), // portal password, auto-generated if omitted
  currency: z.enum(['USD', 'EUR', 'INR']).default('USD'),
  credit_limit: z.number().nonnegative().default(0),
  tps_limit: z.number().int().positive().default(50),
});

router.post('/portal-accounts', requirePerm('clients.create'), audit('created_portal_account', 'client'), async (req, res) => {
  const parsed = portalCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const smppPassword = crypto.randomBytes(12).toString('base64url');
  const portalPassword = b.password ?? crypto.randomBytes(12).toString('base64url');
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const emailTaken = await db.query('SELECT 1 FROM clients WHERE lower(portal_email)=lower($1)', [b.portal_email]);
    if (emailTaken.rowCount) {
      await db.query('ROLLBACK');
      res.status(409).json({ error: 'portal email already in use' });
      return;
    }
    const { rows } = await db.query(
      `INSERT INTO clients (name, company_name, system_id, password_hash, status, credit_limit, currency,
                            tps_limit, billing_mode, portal_email, portal_password_hash, portal_enabled)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7,'postpay',$8,$9,true) RETURNING *`,
      [
        b.name, b.company_name ?? null, b.system_id, await hashPassword(smppPassword),
        b.credit_limit, b.currency, b.tps_limit,
        b.portal_email.toLowerCase(), await hashPassword(portalPassword),
      ],
    );
    const created = rows[0];
    await db.query(
      'INSERT INTO wallets (client_id, balance, credit_limit, currency, billing_mode) VALUES ($1,0,$2,$3,$4)',
      [created.id, b.credit_limit, b.currency, 'postpay'],
    );
    await db.query('COMMIT');
    const { password_hash: _h1, portal_password_hash: _h2, ...safe } = created;
    void _h1;
    void _h2;
    res.status(201).json({
      client: safe,
      portal: { portal_email: b.portal_email.toLowerCase(), password: portalPassword }, // shown ONCE
      smpp_note: 'SMPP password auto-generated — re-issue from Client detail if they need SMPP binds.',
    });
  } catch (e) {
    await db.query('ROLLBACK');
    const msg = (e as { code?: string }).code === '23505' ? 'system_id already exists' : 'create failed';
    res.status(409).json({ error: msg });
  } finally {
    db.release();
  }
});

// ── List / search ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status, q } = req.query as { status?: string; q?: string };
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(c.name ILIKE $${params.length} OR c.system_id ILIKE $${params.length} OR c.company_name ILIKE $${params.length})`);
  }
  const rows = await query(
    `SELECT c.*,
            (SELECT count(*) FROM client_ips i WHERE i.client_id=c.id AND i.enabled) AS ip_count,
            (SELECT count(*) FROM client_binds b WHERE b.client_id=c.id) AS bind_count,
            (SELECT max(b.last_activity_at) FROM client_binds b WHERE b.client_id=c.id) AS bind_last_activity,
            (SELECT max(l.created_at) FROM smpp_logs l WHERE l.client_id=c.id) AS last_seen_at
     FROM clients c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.created_at DESC LIMIT 200`,
    params,
  );
  res.json({ clients: rows });
});

// ── Create client + generate SMPP credentials (§5) ───────────────────────────
const createSchema = z.object({
  name: z.string().min(1),
  company_name: z.string().optional(),
  system_id: z.string().min(3).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(8).optional(), // auto-generated if omitted
  status: z.enum(['active', 'suspended', 'blocked', 'pending']).default('pending'),
  credit_limit: z.number().nonnegative().default(0),
  currency: z.enum(['USD', 'EUR', 'INR']).default('USD'),
  tps_limit: z.number().int().positive().default(50),
  daily_limit: z.number().int().positive().nullable().optional(),
  monthly_limit: z.number().int().positive().nullable().optional(),
  allowed_ips: z.array(z.string()).default([]),
  dlr_mode: z.enum(['smpp', 'http', 'api', 'none']).default('smpp'),
  dlr_callback_url: z.string().url().nullable().optional(),
  notes: z.string().optional(),
});

router.post(
  '/',
  requirePerm('clients.create'),
  audit('created_client', 'client'),
  async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const plainPassword = b.password ?? crypto.randomBytes(12).toString('base64url');
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO clients (name, company_name, system_id, password_hash, status, credit_limit, currency,
                              tps_limit, daily_limit, monthly_limit, dlr_mode, dlr_callback_url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          b.name, b.company_name ?? null, b.system_id, await hashPassword(plainPassword),
          b.status, b.credit_limit, b.currency, b.tps_limit, b.daily_limit ?? null,
          b.monthly_limit ?? null, b.dlr_mode, b.dlr_callback_url ?? null, b.notes ?? null,
        ],
      );
      const created = rows[0];
      await client.query(
        'INSERT INTO wallets (client_id, balance, credit_limit, currency) VALUES ($1,0,$2,$3)',
        [created.id, b.credit_limit, b.currency],
      );
      for (const ip of b.allowed_ips) {
        await client.query('INSERT INTO client_ips (client_id, ip) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
          created.id,
          ip,
        ]);
      }
      await client.query('COMMIT');

      // ── Handoff pack (§5): everything the client needs to connect ─────────
      // - their credentials (shown ONCE — never stored plain, never logged)
      // - the IPs we whitelisted for them
      // - OUR gateway IP:port they must whitelist on their firewall
      const smppHost = process.env.SMPP_PUBLIC_HOST ?? 'smpp.8xtelsmpp.com';
      const smppPort = Number(process.env.SMPP_PORT ?? 2775);
      const gatewayIp = process.env.SMPP_GATEWAY_IP ?? smppHost;
      res.status(201).json({
        client: created,
        credentials: {
          system_id: b.system_id,
          password: plainPassword,
          password_mode: req.body?.password ? 'manual' : 'generated',
          host: smppHost,
          port: smppPort,
          bind_types: ['transceiver', 'transmitter', 'receiver'],
          enquire_link_sec: 30,
        },
        handoff: {
          whitelisted_for_client: b.allowed_ips,
          whitelist_note:
            b.allowed_ips.length > 0
              ? `We have whitelisted your IP(s): ${b.allowed_ips.join(', ')}. Binds from any other IP will be rejected.`
              : 'No IP restriction set — binds are accepted from any IP. Add IPs later to lock this down.',
          our_gateway: {
            ip: gatewayIp,
            port: smppPort,
            note: `Please whitelist our gateway IP ${gatewayIp} on port ${smppPort} (TCP outbound) on your firewall so our DLRs and enquire_links reach you.`,
          },
          message:
            `Your SMPP account is ready.\n` +
            `Host: ${smppHost}\nPort: ${smppPort}\n` +
            `Username (system_id): ${b.system_id}\nPassword: ${plainPassword}\n` +
            (b.allowed_ips.length > 0
              ? `We have whitelisted your IP(s): ${b.allowed_ips.join(', ')}.\n`
              : `No IP restriction applied.\n`) +
            `Please whitelist our IP ${gatewayIp}:${smppPort} on your firewall.`,
        },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      const msg = (e as { code?: string }).code === '23505' ? 'system_id already exists' : 'create failed';
      res.status(409).json({ error: msg });
    } finally {
      client.release();
    }
  },
);

router.get('/:id', async (req, res) => {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM clients WHERE id=$1', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const ips = await query('SELECT * FROM client_ips WHERE client_id=$1 ORDER BY created_at', [req.params.id]);
  const rates = await query(
    `SELECT cr.*, c.name AS country_name, c.iso_code FROM client_rates cr
     LEFT JOIN countries c ON c.id=cr.country_id WHERE cr.client_id=$1 ORDER BY cr.prefix NULLS LAST`,
    [req.params.id],
  );
  // Active routes serving this client: dedicated + global fallback minus
  // per-client exclusions, sms only. Mirrors the routing engine's candidate
  // set (minus vendor-chain expansion).
  const routes = await query(
    `SELECT r.id, r.name, r.strategy, r.status, r.prefix, r.sender_id,
            r.price_per_segment, COALESCE(r.price_currency,'USD') AS price_currency,
            r.min_margin_pct,
            (r.client_id IS NOT NULL) AS dedicated,
            co.id AS country_id, co.name AS country_name, co.iso_code, co.calling_code,
            (SELECT count(*) FROM route_vendors rv WHERE rv.route_id=r.id) AS vendor_count,
            (SELECT min(vr.cost) FROM vendor_rates vr JOIN route_vendors rv2 ON rv2.vendor_id=vr.vendor_id
             WHERE rv2.route_id=r.id AND (vr.country_id IS NULL OR vr.country_id=r.country_id)) AS min_vendor_cost
     FROM routes r LEFT JOIN countries co ON co.id=r.country_id
     WHERE r.status='active' AND r.channel='sms'
       AND (r.client_id IS NULL OR r.client_id=$1::uuid)
       AND NOT EXISTS (
         SELECT 1 FROM route_client_exclusions x
         WHERE x.route_id=r.id AND x.client_id=$1::uuid
       )
     ORDER BY (r.client_id IS NULL), co.name NULLS LAST, r.name`,
    [req.params.id],
  );
  // ── Overview stats: traffic today / all-time, balance in / out ──────────
  const [traffic] = await query<{
    today: string; all_time: string; delivered: string; failed: string;
  }>(
    `SELECT COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS today,
            COUNT(*) AS all_time,
            COUNT(*) FILTER (WHERE status='delivered') AS delivered,
            COUNT(*) FILTER (WHERE status IN ('failed','undelivered','expired','rejected')) AS failed
     FROM messages WHERE client_id=$1`,
    [req.params.id],
  );
  const [funds] = await query<{ topped_up: string; spent: string }>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE type IN ('credit','topup')),0) AS topped_up,
            COALESCE(SUM(-amount) FILTER (WHERE type='debit'),0) AS spent
     FROM transactions WHERE client_id=$1`,
    [req.params.id],
  );
  const delivered = Number(traffic.delivered);
  const decided = delivered + Number(traffic.failed);
  // ── Live bind state: current sessions + last-seen fallback ─────────────
  const binds = await query(
    `SELECT id, bind_type, remote_ip, connected_since, last_activity_at, submit_count
     FROM client_binds WHERE client_id=$1 ORDER BY connected_since`,
    [req.params.id],
  );
  const lastLog = await queryOne<{ kind: string | null; result: string | null; reason: string | null; ip: string | null; created_at: string | null }>(
    `SELECT kind, result, reason, ip, created_at FROM smpp_logs
     WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [req.params.id],
  );
  const { password_hash: _omit, ...safe } = row;
  void _omit;
  res.json({
    client: safe,
    ips,
    rates,
    routes,
    binds,
    last_log: lastLog ?? null,
    stats: {
      traffic_today: Number(traffic.today),
      traffic_all_time: Number(traffic.all_time),
      delivered,
      delivery_pct: decided ? +(delivered / decided * 100).toFixed(1) : 100,
      balance: Number((safe as Record<string, unknown>).balance ?? 0),
      currency: (safe as Record<string, unknown>).currency ?? 'USD',
      total_topped_up: Number(funds.topped_up),
      total_spent: Number(funds.spent),
    },
  });
});

// ── Bind status + diagnosis: why is this client (not) connected? ────────────
// Live rows in client_binds = currently bound. No rows = offline, and the
// diagnosis is built from account state + the latest smpp_logs line so the
// panel explains the state even when the client never reached us (e.g. their
// firewall blocks :2775 — no log row exists at all).
router.get('/:id/bind-status', async (req, res) => {
  const row = await queryOne<{
    id: string; name: string; system_id: string; status: string;
    balance: string; credit_limit: string; tps_limit: number;
  }>(
    'SELECT id, name, system_id, status, balance, credit_limit, tps_limit FROM clients WHERE id=$1',
    [req.params.id],
  );
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const binds = await query(
    `SELECT id, bind_type, remote_ip, connected_since, last_activity_at, submit_count
     FROM client_binds WHERE client_id=$1 ORDER BY connected_since`,
    [req.params.id],
  );
  const ips = await query<{ ip: string }>(
    'SELECT ip FROM client_ips WHERE client_id=$1 AND enabled=true', [req.params.id],
  );
  const logs = await query(
    `SELECT kind, ip, system_id, result, reason, created_at FROM smpp_logs
     WHERE client_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [req.params.id],
  );

  const online = binds.length > 0;
  let status: string;
  let why: string;
  let next_step: string;
  if (online) {
    const types = [...new Set(binds.map((b) => String((b as Record<string, unknown>).bind_type)))].join(', ');
    const from = [...new Set(binds.map((b) => String((b as Record<string, unknown>).remote_ip)))].join(', ');
    status = 'connected';
    why = `"${row.system_id}" has ${binds.length} live bind(s) (${types}) from ${from}.`;
    next_step = 'No action needed. If traffic is not flowing, check routes and client TPS/balance.';
  } else if (row.status !== 'active') {
    status = 'offline';
    why = `Account is ${row.status.toUpperCase()} — binds are rejected at auth even if the client dials correctly.`;
    next_step = `Set the account back to active (Client detail → Account actions)${row.status === 'pending' ? '; pending accounts are usually brand-new and not handed off yet' : ''}.`;
  } else if (Number(row.balance) + Number(row.credit_limit) <= 0) {
    status = 'offline';
    why = 'Wallet is empty (balance + credit ≤ 0) — binds are rejected at auth with "insufficient balance".';
    next_step = 'Top up the wallet (Billing → Top up), then ask the client to re-bind.';
  } else {
    const last = logs[0] as { kind?: string; result?: string; reason?: string; ip?: string; system_id?: string; created_at?: string } | undefined;
    if (!last) {
      status = 'offline';
      why = `No bind attempt ever reached us for "${row.system_id}" — the client's TCP packets are not arriving at :2775. This is a network/firewall issue, not credentials or whitelist.`;
      next_step = 'Check: 1) server firewall + cloud security group allow TCP 2775, 2) the host IP you gave them is correct, 3) THEY allow outbound TCP 2775 on their firewall (ask them to try telnet <host> 2775).';
    } else if (last.reason === 'ip_not_whitelisted') {
      status = 'blocked';
      why = `Last attempt from ${last.ip ?? 'unknown IP'} was rejected: IP not whitelisted${ips.length ? ` (allowed: ${ips.map((r) => r.ip).join(', ')})` : ''}.`;
      next_step = `Add ${last.ip} to the IP whitelist below, or fix their egress IP if it changed.`;
    } else if (last.reason === 'bad_password') {
      status = 'blocked';
      why = `Last attempt from ${last.ip ?? 'unknown IP'} used a wrong password.`;
      next_step = 'Re-issue credentials (Show / re-issue password) and send them the new handoff.';
    } else if (last.reason === 'unknown_system_id') {
      status = 'blocked';
      why = `Last attempt used an unknown system_id ("${last.system_id ?? '?'}").`;
      next_step = `Confirm they bind with exactly "${row.system_id}" (case-sensitive).`;
    } else if (last.kind === 'bind' && last.result === 'accept') {
      status = 'offline';
      why = `Last bind from ${last.ip ?? 'unknown IP'} was ACCEPTED${last.created_at ? ` at ${new Date(last.created_at).toLocaleString()}` : ''} but the session is now gone — the client disconnected or their link dropped.`;
      next_step = 'Ask the client to re-bind. If binds flap repeatedly, check their enquire_link interval (30s) and NAT timeouts.';
    } else {
      status = 'offline';
      why = `Last attempt: ${last.kind ?? '?'} / ${last.result ?? '?'}${last.reason ? ` (${last.reason})` : ''}${last.ip ? ` from ${last.ip}` : ''}.`;
      next_step = 'Check the log trail below, then verify credentials + whitelist with the client.';
    }
  }

  res.json({
    client_id: row.id,
    system_id: row.system_id,
    status,
    binds,
    whitelist: ips.map((r) => r.ip),
    last_seen_at: (logs[0] as { created_at?: string } | undefined)?.created_at ?? null,
    diagnosis: {
      account_status: row.status,
      bind_count: binds.length,
      log_entries: logs.length,
      why,
      next_step,
    },
    logs,
  });
});

// ── Re-issue credentials: rotate + return plain password ONCE ───────────────
// Passwords are stored as bcrypt hashes and cannot be retrieved — "showing"
// the password means generating a new one. Requires explicit confirm on UI.
router.post('/:id/credentials', requirePerm('clients.update'), audit('reissued_client_password', 'client'), async (req, res) => {
  const row = await queryOne<{ system_id: string }>('SELECT system_id FROM clients WHERE id=$1', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const plain = crypto.randomBytes(12).toString('base64url');
  await query('UPDATE clients SET password_hash=$1, updated_at=now() WHERE id=$2', [
    await hashPassword(plain),
    req.params.id,
  ]);
  res.json({
    system_id: row.system_id,
    password: plain, // shown ONCE
    host: process.env.SMPP_PUBLIC_HOST ?? 'smpp.8xtelsmpp.com',
    port: Number(process.env.SMPP_PORT ?? 2775),
  });
});

// ── Portal login: set/reset client portal password (shown ONCE) ─────────────
// Separate from SMPP credentials. House accounts can never get portal access.
router.post('/:id/portal-password', requirePerm('clients.update'), audit('set_portal_password', 'client'), async (req, res) => {
  const row = await queryOne<{ portal_email: string | null; is_house: boolean }>(
    'SELECT portal_email, COALESCE(is_house,false) AS is_house FROM clients WHERE id=$1', [req.params.id],
  );
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (row.is_house) {
    res.status(422).json({ error: 'house accounts cannot have portal access' });
    return;
  }
  if (!row.portal_email) {
    res.status(422).json({ error: 'set a portal email first' });
    return;
  }
  const plain = crypto.randomBytes(12).toString('base64url');
  await query('UPDATE clients SET portal_password_hash=$1, portal_enabled=true, updated_at=now() WHERE id=$2', [
    await hashPassword(plain),
    req.params.id,
  ]);
  res.json({ portal_email: row.portal_email, password: plain }); // shown ONCE
});

router.patch('/:id', requirePerm('clients.update'), audit('updated_client', 'client'), async (req, res) => {
  const allowed = [
    'name', 'company_name', 'status', 'credit_limit', 'tps_limit', 'daily_limit',
    'monthly_limit', 'dlr_mode', 'dlr_callback_url', 'notes', 'default_route_id', 'pricing_profile_id',
    'portal_email', 'portal_enabled',
  ] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) {
      params.push(req.body[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (!sets.length) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  params.push(req.params.id);
  const rows = await query(
    `UPDATE clients SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`,
    params,
  );
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ client: rows[0] });
});

// ── IP whitelist (§6) ────────────────────────────────────────────────────────
router.post('/:id/ips', requirePerm('clients.update'), audit('added_client_ip', 'client_ip'), async (req, res) => {
  const parsed = z.object({ ip: z.string().min(3) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid ip' });
    return;
  }
  const rows = await query(
    'INSERT INTO client_ips (client_id, ip) VALUES ($1,$2) ON CONFLICT (client_id, ip) DO UPDATE SET enabled=true RETURNING *',
    [req.params.id, parsed.data.ip],
  );
  res.status(201).json({ ip: rows[0] });
});

router.delete('/:id/ips/:ipId', requirePerm('clients.update'), audit('removed_client_ip', 'client_ip'), async (req, res) => {
  await query('DELETE FROM client_ips WHERE id=$1 AND client_id=$2', [req.params.ipId, req.params.id]);
  res.json({ ok: true });
});

router.patch('/:id/ips/:ipId', requirePerm('clients.update'), audit('toggled_client_ip', 'client_ip'), async (req, res) => {
  const rows = await query(
    'UPDATE client_ips SET enabled=$1 WHERE id=$2 AND client_id=$3 RETURNING *',
    [req.body.enabled !== false, req.params.ipId, req.params.id],
  );
  res.json({ ip: rows[0] ?? null });
});

// ── Delete client (§4) ───────────────────────────────────────────────────────
// House accounts can never be deleted. Clients with traffic keep their
// message history (messages.client_id is nulled); wallet + ledger rows are
// removed with the account.
router.delete('/:id', requirePerm('clients.delete'), audit('deleted_client', 'client'), async (req, res) => {
  const row = await queryOne<{ id: string; name: string; system_id: string; is_house: boolean }>(
    'SELECT id, name, system_id, COALESCE(is_house,false) AS is_house FROM clients WHERE id=$1',
    [req.params.id],
  );
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (row.is_house) {
    res.status(422).json({ error: 'house accounts cannot be deleted' });
    return;
  }
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Detach history so message/DLR reports survive the delete
    await db.query('UPDATE billing_records SET client_id=NULL WHERE client_id=$1', [req.params.id]);
    await db.query('UPDATE messages SET client_id=NULL WHERE client_id=$1', [req.params.id]);
    await db.query('UPDATE campaigns SET client_id=NULL WHERE client_id=$1', [req.params.id]);
    await db.query('UPDATE routes SET client_id=NULL WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM transactions WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM wallets WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM sender_requests WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM topup_requests WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM sender_ids WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM client_rates WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM client_ips WHERE client_id=$1', [req.params.id]);
    await db.query('DELETE FROM smpp_logs WHERE client_id=$1', [req.params.id]);
    const r = await db.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
    await db.query('COMMIT');
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: `delete failed: ${(e as Error).message}` });
  } finally {
    db.release();
  }
});

// ── Regenerate SMPP password (§5, §32 rotation) ─────────────────────────────
router.post('/:id/rotate-password', requirePerm('clients.update'), audit('rotated_client_password', 'client'), async (req, res) => {
  const plain = crypto.randomBytes(12).toString('base64url');
  await query('UPDATE clients SET password_hash=$1, updated_at=now() WHERE id=$2', [
    await hashPassword(plain),
    req.params.id,
  ]);
  res.json({ password: plain }); // shown once
});

// ── Client HTTP API keys (for /client/v1/* send API) ─────────────────────────
// Key plaintext shown ONCE at creation; only sha256 hash stored.
router.get('/:id/api-keys', async (req, res) => {
  const rows = await query(
    `SELECT id, key_prefix, label, is_active, last_used_at, created_at
     FROM client_api_keys WHERE client_id=$1 ORDER BY created_at DESC`,
    [req.params.id],
  );
  res.json({ keys: rows });
});

router.post('/:id/api-keys', requirePerm('clients.update'), audit('created_client_api_key', 'client'), async (req, res) => {
  const client = await queryOne('SELECT id FROM clients WHERE id=$1', [req.params.id]);
  if (!client) {
    res.status(404).json({ error: 'client not found' });
    return;
  }
  const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 100) : null;
  const plain = `x8_${crypto.randomBytes(24).toString('base64url')}`;
  const keyHash = crypto.createHash('sha256').update(plain).digest('hex');
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO client_api_keys (client_id, key_hash, key_prefix, label)
     VALUES ($1,$2,$3,$4) RETURNING id, key_prefix, label, created_at`,
    [req.params.id, keyHash, plain.slice(0, 11), label],
  );
  res.status(201).json({ key: { ...rows[0], value: plain } }); // value shown once
});

router.patch('/:id/api-keys/:keyId', requirePerm('clients.update'), audit('toggled_client_api_key', 'client'), async (req, res) => {
  const active = req.body?.is_active;
  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'provide body.is_active boolean' });
    return;
  }
  const rows = await query(
    'UPDATE client_api_keys SET is_active=$1 WHERE id=$2 AND client_id=$3 RETURNING id, is_active',
    [active, req.params.keyId, req.params.id],
  );
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ key: rows[0] });
});

router.delete('/:id/api-keys/:keyId', requirePerm('clients.update'), audit('deleted_client_api_key', 'client'), async (req, res) => {
  const r = await getPool().query(
    'DELETE FROM client_api_keys WHERE id=$1 AND client_id=$2', [req.params.keyId, req.params.id],
  );
  if (!r.rowCount) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
