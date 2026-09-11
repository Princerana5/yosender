import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query, queryOne, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { hashPassword } from '../auth.js';

const router = Router();
router.use(requirePerm('clients.read'));

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
    `SELECT c.*, (SELECT count(*) FROM client_ips i WHERE i.client_id=c.id AND i.enabled) AS ip_count
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
  currency: z.string().length(3).default('USD'),
  tps_limit: z.number().int().positive().default(10),
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
      res.status(201).json({
        client: created,
        // Shown ONCE — never stored in plain text, never logged (§32)
        credentials: {
          system_id: b.system_id,
          password: plainPassword,
          host: process.env.SMPP_PUBLIC_HOST ?? 'smpp.8xtelsmpp.com',
          port: Number(process.env.SMPP_PORT ?? 2775),
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
  const row = await queryOne('SELECT * FROM clients WHERE id=$1', [req.params.id]);
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
  res.json({ client: row, ips, rates });
});

router.patch('/:id', requirePerm('clients.update'), audit('updated_client', 'client'), async (req, res) => {
  const allowed = [
    'name', 'company_name', 'status', 'credit_limit', 'tps_limit', 'daily_limit',
    'monthly_limit', 'dlr_mode', 'dlr_callback_url', 'notes', 'default_route_id', 'pricing_profile_id',
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

// ── Regenerate SMPP password (§5, §32 rotation) ─────────────────────────────
router.post('/:id/rotate-password', requirePerm('clients.update'), audit('rotated_client_password', 'client'), async (req, res) => {
  const plain = crypto.randomBytes(12).toString('base64url');
  await query('UPDATE clients SET password_hash=$1, updated_at=now() WHERE id=$2', [
    await hashPassword(plain),
    req.params.id,
  ]);
  res.json({ password: plain }); // shown once
});

export default router;
