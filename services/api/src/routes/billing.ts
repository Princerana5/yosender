import { Router } from 'express';
import { z } from 'zod';
import { query, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();
router.use(requirePerm('billing.read'));

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'INR'] as const;

async function fxRate(code: string): Promise<number> {
  const row = await query<{ rate_to_usd: string }>('SELECT rate_to_usd FROM fx_rates WHERE code=$1', [code]);
  if (!row.length) throw new Error(`unsupported currency ${code}`);
  return Number(row[0].rate_to_usd);
}

// ── Currencies + FX ──────────────────────────────────────────────────────────
router.get('/currencies', async (_req, res) => {
  res.json({ currencies: await query('SELECT * FROM fx_rates ORDER BY code') });
});

router.patch('/currencies/:code', requirePerm('billing.manage'), audit('updated_fx_rate', 'fx_rate'), async (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(code as (typeof SUPPORTED_CURRENCIES)[number])) {
    res.status(400).json({ error: 'currency must be USD, EUR or INR' });
    return;
  }
  const rate = Number(req.body?.rate_to_usd);
  if (!rate || rate <= 0) {
    res.status(400).json({ error: 'rate_to_usd must be positive' });
    return;
  }
  const rows = await query('UPDATE fx_rates SET rate_to_usd=$1, updated_at=now() WHERE code=$2 RETURNING *', [rate, code]);
  res.json({ currency: rows[0] });
});

router.get('/wallets', async (_req, res) => {
  const rows = await query(
    `SELECT w.*, c.name AS client_name, c.system_id, c.status AS client_status FROM wallets w
     JOIN clients c ON c.id=w.client_id ORDER BY c.name`,
  );
  res.json({ wallets: rows });
});

// ── Change wallet currency (converts balance + credit at current FX) ─────────
router.post('/wallets/:clientId/currency', requirePerm('billing.manage'), audit('changed_wallet_currency', 'wallet'), async (req, res) => {
  const to = String(req.body?.currency ?? '').toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(to as (typeof SUPPORTED_CURRENCIES)[number])) {
    res.status(400).json({ error: 'currency must be USD, EUR or INR' });
    return;
  }
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cur = await db.query('SELECT balance, credit_limit, currency FROM wallets WHERE client_id=$1', [req.params.clientId]);
    if (!cur.rowCount) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'wallet not found' });
      return;
    }
    const from = cur.rows[0].currency as string;
    if (from === to) {
      await db.query('ROLLBACK');
      res.json({ wallet: cur.rows[0], converted: false });
      return;
    }
    const fromRate = await fxRate(from);
    const toRate = await fxRate(to);
    // native → USD → target
    const convert = (n: number): number => +(Number(n) * fromRate / toRate).toFixed(6);
    const newBalance = convert(Number(cur.rows[0].balance));
    const newCredit = convert(Number(cur.rows[0].credit_limit));
    await db.query('UPDATE wallets SET balance=$1, credit_limit=$2, currency=$3, updated_at=now() WHERE client_id=$4', [
      newBalance, newCredit, to, req.params.clientId,
    ]);
    await db.query('UPDATE clients SET balance=$1, credit_limit=$2, currency=$3 WHERE id=$4', [
      newBalance, newCredit, to, req.params.clientId,
    ]);
    await db.query(
      `INSERT INTO transactions (client_id, type, amount, balance_after, description, currency, created_by)
       VALUES ($1,'adjustment',0,$2,$3,$4,$5)`,
      [req.params.clientId, newBalance, `Currency change ${from} → ${to} @ FX`, to, (req.user as { id: string }).id],
    );
    await db.query('COMMIT');
    res.json({ wallet: { balance: newBalance, credit_limit: newCredit, currency: to }, converted: true, from, to });
  } catch (e) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: 'currency change failed' });
  } finally {
    db.release();
  }
});

// Top-up (§28) — immutable ledger entry, remark mandatory
router.post('/wallets/:clientId/topup', requirePerm('billing.manage'), audit('wallet_topup', 'wallet'), async (req, res) => {
  const parsed = z.object({
    amount: z.number().positive(),
    remark: z.string().trim().min(3, 'remark is required (min 3 chars)'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
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
    const { rows } = await client.query('SELECT balance, currency FROM wallets WHERE client_id=$1', [req.params.clientId]);
    await client.query(
      `INSERT INTO transactions (client_id, type, amount, balance_after, description, remark, currency, created_by)
       VALUES ($1,'credit',$2,$3,$4,$4,$5,$6)`,
      [req.params.clientId, parsed.data.amount, rows[0].balance, parsed.data.remark, rows[0].currency, (req.user as { id: string }).id],
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

// Deduct — manual balance subtraction (penalty/correction), remark mandatory.
// Floor: prepay cannot go below 0; postpay cannot exceed -credit_limit.
router.post('/wallets/:clientId/deduct', requirePerm('billing.manage'), audit('wallet_deduct', 'wallet'), async (req, res) => {
  const parsed = z.object({
    amount: z.number().positive(),
    remark: z.string().trim().min(3, 'remark is required (min 3 chars)'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cur = await db.query(
      'SELECT balance, credit_limit, currency, billing_mode FROM wallets WHERE client_id=$1',
      [req.params.clientId],
    );
    if (!cur.rowCount) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'wallet not found' });
      return;
    }
    const w = cur.rows[0] as { balance: string; credit_limit: string; currency: string; billing_mode: string };
    const after = Number(w.balance) - parsed.data.amount;
    const floor = w.billing_mode === 'postpay' ? -Number(w.credit_limit) : 0;
    if (after < floor) {
      await db.query('ROLLBACK');
      res.status(422).json({
        error: w.billing_mode === 'postpay'
          ? `would exceed credit limit (${w.currency} ${w.credit_limit})`
          : 'insufficient balance (prepay cannot go negative)',
      });
      return;
    }
    await db.query('UPDATE wallets SET balance=$1, updated_at=now() WHERE client_id=$2', [after, req.params.clientId]);
    await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [after, req.params.clientId]);
    await db.query(
      `INSERT INTO transactions (client_id, type, amount, balance_after, description, remark, currency, created_by)
       VALUES ($1,'debit',$2,$3,$4,$4,$5,$6)`,
      [req.params.clientId, -parsed.data.amount, after, parsed.data.remark, w.currency, (req.user as { id: string }).id],
    );
    await db.query('COMMIT');
    res.json({ balance: after });
  } catch (e) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: 'deduct failed' });
  } finally {
    db.release();
  }
});

// Billing mode + credit limit — prepay/postpay switch for a client
router.post('/wallets/:clientId/billing-mode', requirePerm('billing.manage'), audit('changed_billing_mode', 'wallet'), async (req, res) => {
  const parsed = z.object({
    billing_mode: z.enum(['prepay', 'postpay']),
    credit_limit: z.number().nonnegative().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (parsed.data.credit_limit !== undefined) {
      await db.query('UPDATE wallets SET credit_limit=$1 WHERE client_id=$2', [parsed.data.credit_limit, req.params.clientId]);
      await db.query('UPDATE clients SET credit_limit=$1 WHERE id=$2', [parsed.data.credit_limit, req.params.clientId]);
    }
    await db.query('UPDATE wallets SET billing_mode=$1, updated_at=now() WHERE client_id=$2', [parsed.data.billing_mode, req.params.clientId]);
    await db.query('UPDATE clients SET billing_mode=$1 WHERE id=$2', [parsed.data.billing_mode, req.params.clientId]);
    const { rows } = await db.query('SELECT balance, credit_limit, currency, billing_mode FROM wallets WHERE client_id=$1', [req.params.clientId]);
    await db.query(
      `INSERT INTO transactions (client_id, type, amount, balance_after, description, remark, currency, created_by)
       VALUES ($1,'adjustment',0,$2,$3,$4,$5,$6)`,
      [req.params.clientId, rows[0].balance,
       `Billing mode → ${parsed.data.billing_mode}, credit ${rows[0].credit_limit}`,
       `Billing mode → ${parsed.data.billing_mode}`, rows[0].currency, (req.user as { id: string }).id],
    );
    await db.query('COMMIT');
    res.json({ wallet: rows[0] });
  } catch (e) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: 'billing mode change failed' });
  } finally {
    db.release();
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
