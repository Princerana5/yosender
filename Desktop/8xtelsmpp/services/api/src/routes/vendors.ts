import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, queryOne, getPool, getRedis } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('vendors.read'));

/** Tell vendor-workers to reconcile binds with the vendors table (no restart).
    Fire-and-forget: a 60s periodic sync in the worker covers missed signals. */
function signalVendorSync(vendorId: string): void {
  getRedis().publish('smpp:control', JSON.stringify({ action: 'sync', vendor_id: vendorId, at: Date.now() }))
    .catch((e) => console.error('[vendors] sync signal failed', (e as Error).message));
}

// Vendor passwords are encrypted at rest (AES-256-GCM, §32). Key from env.
function encKey(): Buffer {
  const raw = process.env.VENDOR_SECRET_KEY ?? 'dev-vendor-key-please-change-32b!!';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

const vendorSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().default(2775),
  system_id: z.string().min(1),
  password: z.string().min(1),
  bind_type: z.enum(['transceiver', 'transmitter', 'receiver']).default('transceiver'),
  source_ton: z.number().int().default(0),
  source_npi: z.number().int().default(1),
  dest_ton: z.number().int().default(0),
  dest_npi: z.number().int().default(1),
  tps: z.number().int().positive().default(50),
  // Transport: 'smpp' (classic bind) or 'http' (upstream HTTP API).
  // Defaults to smpp so every existing vendor keeps its behavior.
  protocol: z.enum(['smpp', 'http']).default('smpp'),
  connection_count: z.number().int().min(1).max(16).default(1),
  dlr_supported: z.boolean().default(true),
  use_tls: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('disabled'),
  reconnect_interval_sec: z.number().int().min(2).default(10),
  sender_id_rule: z.string().default('passthrough'),
});

router.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT v.*,
       (SELECT json_agg(vc) FROM vendor_connections vc WHERE vc.vendor_id=v.id) AS connections,
       (SELECT count(*) FROM route_vendors rv JOIN routes r ON r.id=rv.route_id WHERE rv.vendor_id=v.id AND r.status='active') AS active_route_count,
       (SELECT count(DISTINCT r.country_id) FROM route_vendors rv JOIN routes r ON r.id=rv.route_id WHERE rv.vendor_id=v.id) AS coverage_count
     FROM vendors v ORDER BY v.created_at DESC`,
  );
  // never leak encrypted password
  res.json({ vendors: rows.map((r) => ({ ...(r as object), password_enc: undefined })) });
});

router.post('/', requirePerm('vendors.create'), audit('created_vendor', 'vendor'), async (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO vendors (name, host, port, system_id, password_enc, bind_type, source_ton, source_npi,
                            dest_ton, dest_npi, tps, protocol, connection_count, dlr_supported, use_tls, status,
                            reconnect_interval_sec, sender_id_rule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        b.name, b.host, b.port, b.system_id, encryptSecret(b.password), b.bind_type,
        b.source_ton, b.source_npi, b.dest_ton, b.dest_npi, b.tps, b.protocol, b.connection_count,
        b.dlr_supported, b.use_tls, b.status, b.reconnect_interval_sec, b.sender_id_rule,
      ],
    );
    const vendor = rows[0];
    // SMPP vendors get bind rows; HTTP vendors hold no binds (one HTTPS
    // request per message instead), so skip — phantom rows would render as
    // stuck "disconnected" binds in the panel.
    if (b.protocol !== 'http') {
      for (let i = 0; i < b.connection_count; i++) {
        await pool.query(
          'INSERT INTO vendor_connections (vendor_id, conn_index) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [vendor.id, i],
        );
      }
    }
    signalVendorSync(vendor.id); // worker picks up the new binds live
    res.status(201).json({ vendor: { ...vendor, password_enc: undefined } });
  } catch {
    res.status(409).json({ error: 'vendor name already exists' });
  }
});

router.get('/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM vendors WHERE id=$1', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const conns = await query('SELECT * FROM vendor_connections WHERE vendor_id=$1 ORDER BY conn_index', [req.params.id]);
  const rates = await query(
    `SELECT vr.*, c.name AS country_name FROM vendor_rates vr
     LEFT JOIN countries c ON c.id=vr.country_id WHERE vr.vendor_id=$1 ORDER BY vr.prefix NULLS LAST LIMIT 500`,
    [req.params.id],
  );
  const { password_enc: _omit, ...safe } = row as Record<string, unknown>;
  void _omit;
  res.json({ vendor: safe, connections: conns, rates });
});

router.patch('/:id', requirePerm('vendors.update'), audit('updated_vendor', 'vendor'), async (req, res) => {
  const allowed = [
    'name', 'host', 'port', 'system_id', 'bind_type', 'source_ton', 'source_npi', 'dest_ton',
    'dest_npi', 'tps', 'protocol', 'connection_count', 'dlr_supported', 'use_tls', 'status',
    'reconnect_interval_sec', 'sender_id_rule',
  ] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) {
      params.push(req.body[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (req.body?.password) {
    params.push(encryptSecret(String(req.body.password)));
    sets.push(`password_enc = $${params.length}`);
  }
  if (!sets.length) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  params.push(req.params.id);
  const rows = await query(
    `UPDATE vendors SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`,
    params,
  );
  if (!rows.length) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // Keep vendor_connections rows in sync when the bind count changes.
  // HTTP vendors hold no binds: switching to http wipes rows, switching
  // back to smpp recreates them.
  const protocolAfter = (rows[0] as Record<string, unknown>).protocol as string | undefined;
  if (protocolAfter === 'http') {
    await getPool().query('DELETE FROM vendor_connections WHERE vendor_id=$1', [req.params.id]);
  } else if (req.body?.connection_count !== undefined || req.body?.protocol === 'smpp') {
    const n = Math.min(16, Math.max(1, Number(
      req.body?.connection_count ?? (rows[0] as Record<string, unknown>).connection_count ?? 1,
    ) || 1));
    const pool = getPool();
    for (let i = 0; i < n; i++) {
      await pool.query(
        'INSERT INTO vendor_connections (vendor_id, conn_index) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.params.id, i],
      );
    }
    await pool.query('DELETE FROM vendor_connections WHERE vendor_id=$1 AND conn_index >= $2', [req.params.id, n]);
  }
  signalVendorSync(req.params.id); // worker hot-reloads config / stops binds live
  const { password_enc: _o, ...safe } = rows[0] as Record<string, unknown>;
  void _o;
  res.json({ vendor: safe });
});

// ── Delete vendor ────────────────────────────────────────────────────────────
// Detaches routes (route_vendors rows cascade) and keeps message history
// (messages.vendor_id is nulled) so reports survive the delete.
router.delete('/:id', requirePerm('vendors.delete'), audit('deleted_vendor', 'vendor'), async (req, res) => {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('UPDATE billing_records SET vendor_id=NULL WHERE vendor_id=$1', [req.params.id]);
    await db.query('UPDATE message_events SET vendor_id=NULL WHERE vendor_id=$1', [req.params.id]);
    await db.query('UPDATE messages SET vendor_id=NULL WHERE vendor_id=$1', [req.params.id]);
    await db.query('DELETE FROM smpp_logs WHERE vendor_id=$1', [req.params.id]);
    await db.query('DELETE FROM vendor_rates WHERE vendor_id=$1', [req.params.id]);
    await db.query('DELETE FROM vendor_connections WHERE vendor_id=$1', [req.params.id]);
    const r = await db.query('DELETE FROM vendors WHERE id=$1', [req.params.id]);
    await db.query('COMMIT');
    if (!r.rowCount) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    signalVendorSync(req.params.id); // worker drops the binds live
    res.json({ ok: true });
  } catch (e) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: `delete failed: ${(e as Error).message}` });
  } finally {
    db.release();
  }
});

// ── HTTP vendor config (protocol='http' vendors only) ────────────────────────
// Stores the upstream HTTP API template + encrypted headers. Passwords/keys
// are never returned — only presence flags.
const httpConfigSchema = z.object({
  url_template: z.string().min(1),
  method: z.enum(['GET', 'POST']).default('POST'),
  body_template: z.string().nullable().optional(),
  headers: z.record(z.string()).nullable().optional(),
  msgid_json_path: z.string().nullable().optional(),
  timeout_ms: z.number().int().min(1000).max(60000).default(10000),
  verify_tls: z.boolean().default(true),
  dlr_poll_url_template: z.string().max(2000).nullable().optional(),
  dlr_poll_interval_sec: z.number().int().min(5).max(600).default(5),
  // Forced Sender ID + message template (§16): when set, all traffic through
  // this vendor uses force_sender_id as the upstream sender and builds the
  // upstream text from message_template, filling {v1} {v2} … from the client
  // message split on "|". Blank = passthrough (client sender + text as-is).
  force_sender_id: z.string().max(21).nullable().optional(),
  message_template: z.string().max(2000).nullable().optional(),
});

router.get('/:id/http', async (req, res) => {
  const row = await queryOne(
    `SELECT vendor_id, url_template, method, body_template,
            (headers_enc IS NOT NULL) AS has_headers,
            msgid_json_path, timeout_ms, verify_tls,
            dlr_poll_url_template, dlr_poll_interval_sec,
            force_sender_id, message_template, updated_at
     FROM vendor_http_configs WHERE vendor_id=$1`,
    [req.params.id],
  );
  if (!row) {
    res.status(404).json({ error: 'no http config for this vendor' });
    return;
  }
  res.json({ http: row });
});

router.put('/:id/http', requirePerm('vendors.update'), audit('updated_vendor_http', 'vendor'), async (req, res) => {
  const parsed = httpConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const vendor = await queryOne<{ id: string; protocol: string }>(
    'SELECT id, COALESCE(protocol,$1) AS protocol FROM vendors WHERE id=$2', ['smpp', req.params.id],
  );
  if (!vendor) {
    res.status(404).json({ error: 'vendor not found' });
    return;
  }
  if (vendor.protocol !== 'http') {
    res.status(422).json({ error: 'vendor protocol is not http — set protocol=http first' });
    return;
  }
  const b = parsed.data;
  const headersEnc = b.headers ? encryptSecret(JSON.stringify(b.headers)) : null;
  const pool = getPool();
  await pool.query(
    `INSERT INTO vendor_http_configs (vendor_id, url_template, method, body_template, headers_enc, msgid_json_path, timeout_ms, verify_tls, dlr_poll_url_template, dlr_poll_interval_sec, force_sender_id, message_template, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (vendor_id) DO UPDATE SET
       url_template=EXCLUDED.url_template, method=EXCLUDED.method,
       body_template=EXCLUDED.body_template,
       headers_enc=COALESCE(EXCLUDED.headers_enc, vendor_http_configs.headers_enc),
       msgid_json_path=EXCLUDED.msgid_json_path, timeout_ms=EXCLUDED.timeout_ms,
       verify_tls=EXCLUDED.verify_tls,
       dlr_poll_url_template=EXCLUDED.dlr_poll_url_template,
       dlr_poll_interval_sec=EXCLUDED.dlr_poll_interval_sec,
       force_sender_id=EXCLUDED.force_sender_id,
       message_template=EXCLUDED.message_template, updated_at=now()`,
    [req.params.id, b.url_template, b.method, b.body_template ?? null, headersEnc,
     b.msgid_json_path ?? null, b.timeout_ms, b.verify_tls,
     b.dlr_poll_url_template ?? null, b.dlr_poll_interval_sec,
     b.force_sender_id?.trim() || null, b.message_template?.trim() || null],
  );
  signalVendorSync(req.params.id);
  res.json({ ok: true });
});

// ── Per-SID templates (protocol='http' vendors only) ─────────────────────────
// A vendor with several approved Sender IDs gets one row per SID, each with
// its own DLT template. At send time the worker matches the client sender
// (case-insensitive); on no match the default row wins. Zero rows = legacy
// behavior (passthrough / single forced SID from vendor_http_configs).
const senderTemplateSchema = z.object({
  sender_id: z.string().min(1).max(21),
  template: z.string().min(1).max(2000),
  is_default: z.boolean().default(false),
});

router.get('/:id/sender-templates', async (req, res) => {
  const rows = await query(
    `SELECT id, sender_id, template, is_default, updated_at
     FROM vendor_sender_templates WHERE vendor_id=$1 ORDER BY is_default DESC, sender_id`,
    [req.params.id],
  );
  res.json({ templates: rows });
});

router.post('/:id/sender-templates', requirePerm('vendors.update'), audit('created_sender_template', 'vendor'), async (req, res) => {
  const parsed = senderTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const vendor = await queryOne('SELECT id FROM vendors WHERE id=$1', [req.params.id]);
  if (!vendor) {
    res.status(404).json({ error: 'vendor not found' });
    return;
  }
  const pool = getPool();
  const b = parsed.data;
  if (b.is_default) {
    await pool.query('UPDATE vendor_sender_templates SET is_default=FALSE WHERE vendor_id=$1', [req.params.id]);
  }
  const { rows } = await pool.query(
    `INSERT INTO vendor_sender_templates (vendor_id, sender_id, template, is_default)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (vendor_id, sender_id) DO UPDATE SET
       template=EXCLUDED.template, is_default=EXCLUDED.is_default, updated_at=now()
     RETURNING *`,
    [req.params.id, b.sender_id.trim(), b.template.trim(), b.is_default],
  );
  signalVendorSync(req.params.id);
  res.status(201).json({ template: rows[0] });
});

router.delete('/:id/sender-templates/:tplId', requirePerm('vendors.update'), audit('deleted_sender_template', 'vendor'), async (req, res) => {
  const r = await getPool().query(
    'DELETE FROM vendor_sender_templates WHERE id=$1 AND vendor_id=$2', [req.params.tplId, req.params.id],
  );
  if (!r.rowCount) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  signalVendorSync(req.params.id);
  res.json({ ok: true });
});

// ── Inbound DLR webhook tokens ───────────────────────────────────────────────
// POST /vendors/:id/dlr-tokens → { token, url } — token shown ONCE.
// Vendor pushes DLRs to the url; only the sha256 hash is stored.
router.post('/:id/dlr-tokens', requirePerm('vendors.update'), audit('created_vendor_dlr_token', 'vendor'), async (req, res) => {
  const vendor = await queryOne('SELECT id FROM vendors WHERE id=$1', [req.params.id]);
  if (!vendor) {
    res.status(404).json({ error: 'vendor not found' });
    return;
  }
  const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 100) : null;
  const token = `vdlr_${crypto.randomBytes(24).toString('base64url')}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const pool = getPool();
  const { rows } = await pool.query(
    'INSERT INTO vendor_dlr_tokens (vendor_id, token_hash, label) VALUES ($1,$2,$3) RETURNING id, created_at',
    [req.params.id, tokenHash, label],
  );
  const base = (process.env.HTTP_DLR_BASE
    ?? (process.env.SMPP_PUBLIC_HOST ? `https://${process.env.SMPP_PUBLIC_HOST}` : '')).replace(/\/$/, '');
  res.status(201).json({
    id: rows[0].id,
    token, // shown once — never stored, never returned again
    url: base ? `${base}/vendor-dlr/${token}` : `/vendor-dlr/${token}`,
    created_at: rows[0].created_at,
  });
});

router.get('/:id/dlr-tokens', async (req, res) => {
  const rows = await query(
    'SELECT id, label, created_at FROM vendor_dlr_tokens WHERE vendor_id=$1 ORDER BY created_at DESC',
    [req.params.id],
  );
  res.json({ tokens: rows });
});

router.delete('/:id/dlr-tokens/:tokenId', requirePerm('vendors.update'), audit('deleted_vendor_dlr_token', 'vendor'), async (req, res) => {
  const r = await getPool().query(
    'DELETE FROM vendor_dlr_tokens WHERE id=$1 AND vendor_id=$2', [req.params.tokenId, req.params.id],
  );
  if (!r.rowCount) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});

// ── Rate card CSV import (§14): vendor_id,country_iso,prefix,operator,cost ──
router.post('/:id/rates/import', requirePerm('rates.manage'), audit('imported_vendor_rates', 'vendor_rate'), async (req, res) => {
  const rows = req.body?.rates as Array<{ country_iso?: string; prefix?: string; operator?: string; cost: number }> | undefined;
  if (!Array.isArray(rows) || !rows.length) {
    res.status(400).json({ error: 'provide body.rates[]' });
    return;
  }
  const pool = getPool();
  let imported = 0;
  for (const r of rows) {
    let countryId: string | null = null;
    if (r.country_iso) {
      const c = await queryOne<{ id: string }>('SELECT id FROM countries WHERE iso_code=$1', [
        r.country_iso.toUpperCase(),
      ]);
      countryId = c?.id ?? null;
    }
    await pool.query(
      `INSERT INTO vendor_rates (vendor_id, country_id, prefix, operator, cost) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, countryId, r.prefix ?? null, r.operator ?? null, r.cost],
    );
    imported++;
  }
  res.json({ imported });
});

export default router;
