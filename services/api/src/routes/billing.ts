import { Router } from 'express';
import { z } from 'zod';
import { query, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('billing.read'));

router.get('/wallets', async (_req, res) => {
  const rows = await query(
    `SELECT w.*, c.name AS client_name, c.system_id FROM wallets w
     JOIN clients c ON c.id=w.client_id ORDER BY c.name`,
  );
  res.json({ wallets: rows });
});

// Top-up / adjustment (§28) — immutable ledger entry
router.post('/wallets/:clientId/topup', requirePerm('billing.manage'), audit('wallet_topup', 'wallet'), async (req, res) => {
  const parsed = z.object({
    amount: z.number().positive(),
    description: z.string().default('Top-up'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE wallets SET balance = balance + $1, updated_at=now() WHERE client_id=$2',
      [parsed.data.amount, req.params.clientId],
    );
    await client.query(
      'UPDATE clients SET balance = balance + $1 WHERE id=$2',
      [parsed.data.amount, req.params.clientId],
    );
    const { rows } = await client.query('SELECT balance FROM wallets WHERE client_id=$1', [req.params.clientId]);
    await client.query(
      `INSERT INTO transactions (client_id, type, amount, balance_after, description, created_by)
       VALUES ($1,'credit',$2,$3,$4,$5)`,
      [req.params.clientId, parsed.data.amount, rows[0].balance, parsed.data.description, (req.user as { id: string }).id],
    );
    await client.query('COMMIT');
    res.json({ balance: rows[0].balance });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'topup failed' });
  } finally {
    client.release();
  }
});

router.get('/transactions', async (req, res) => {
  const q = req.query as Record<string, string>;
  const rows = await query(
    `SELECT t.*, c.name AS client_name FROM transactions t
     LEFT JOIN clients c ON c.id=t.client_id
     WHERE ($1::uuid IS NULL OR t.client_id=$1::uuid)
     ORDER BY t.created_at DESC LIMIT 200`,
    [q.client_id ?? null],
  );
  res.json({ transactions: rows });
});

// Client rate management (§13)
router.get('/client-rates/:clientId', async (req, res) => {
  const rows = await query(
    `SELECT cr.*, c.name AS country_name FROM client_rates cr
     LEFT JOIN countries c ON c.id=cr.country_id WHERE cr.client_id=$1`,
    [req.params.clientId],
  );
  res.json({ rates: rows });
});

router.post('/client-rates/:clientId', requirePerm('rates.manage'), audit('set_client_rate', 'client_rate'), async (req, res) => {
  const parsed = z.object({
    country_id: z.string().uuid().nullable().optional(),
    prefix: z.string().nullable().optional(),
    price: z.number().nonnegative(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const profile = await query(
    'SELECT pricing_profile_id FROM clients WHERE id=$1', [req.params.clientId],
  );
  let profileId = (profile[0] as { pricing_profile_id: string | null } | undefined)?.pricing_profile_id;
  if (!profileId) {
    const p = await query('INSERT INTO pricing_profiles (name) VALUES ($1) RETURNING id', [
      `profile-${req.params.clientId.slice(0, 8)}`,
    ]);
    profileId = (p[0] as { id: string }).id;
    await query('UPDATE clients SET pricing_profile_id=$1 WHERE id=$2', [profileId, req.params.clientId]);
  }
  const rows = await query(
    `INSERT INTO client_rates (client_id, profile_id, country_id, prefix, price)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (profile_id, country_id, prefix) DO UPDATE SET price=EXCLUDED.price RETURNING *`,
    [req.params.clientId, profileId, parsed.data.country_id ?? null, parsed.data.prefix ?? null, parsed.data.price],
  );
  res.status(201).json({ rate: rows[0] });
});

export default router;
