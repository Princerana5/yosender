import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('vendors.read'));

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
  connection_count: z.number().int().min(1).max(8).default(1),
  dlr_supported: z.boolean().default(true),
  use_tls: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('disabled'),
  reconnect_interval_sec: z.number().int().min(2).default(10),
  sender_id_rule: z.string().default('passthrough'),
});

router.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT v.*, (SELECT json_agg(vc) FROM vendor_connections vc WHERE vc.vendor_id=v.id) AS connections
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
                            dest_ton, dest_npi, tps, connection_count, dlr_supported, use_tls, status,
                            reconnect_interval_sec, sender_id_rule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        b.name, b.host, b.port, b.system_id, encryptSecret(b.password), b.bind_type,
        b.source_ton, b.source_npi, b.dest_ton, b.dest_npi, b.tps, b.connection_count,
        b.dlr_supported, b.use_tls, b.status, b.reconnect_interval_sec, b.sender_id_rule,
      ],
    );
    const vendor = rows[0];
    for (let i = 0; i < b.connection_count; i++) {
      await pool.query(
        'INSERT INTO vendor_connections (vendor_id, conn_index) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [vendor.id, i],
      );
    }
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
    'dest_npi', 'tps', 'connection_count', 'dlr_supported', 'use_tls', 'status',
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
  const { password_enc: _o, ...safe } = rows[0] as Record<string, unknown>;
  void _o;
  res.json({ vendor: safe });
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
