import { Router } from 'express';
import { z } from 'zod';
import { query, getPool } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';

const router = Router();

const upsertSchema = z.object({
  kind: z.enum(['bank', 'upi', 'usdt']),
  label: z.string().min(1).max(120),
  chain: z.enum(['TRC20', 'ERC20', 'BEP20', 'Polygon', 'Other']).nullable().optional(),
  details: z.record(z.unknown()).default({}),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

function validateDetails(kind: string, chain: string | null | undefined, details: Record<string, unknown>): string | null {
  if (kind === 'usdt') {
    if (!chain) return 'chain is required for usdt (TRC20/ERC20/BEP20/Polygon/Other)';
    const addr = String(details.address ?? details.wallet_address ?? '');
    if (addr.length < 26 || addr.length > 64) return 'usdt address must be 26–64 chars';
  } else if (kind === 'bank') {
    if (!details.account_number || !details.bank_name) return 'bank requires account_number and bank_name';
  } else if (kind === 'upi') {
    const upi = String(details.upi_id ?? details.vpa ?? '');
    if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) return 'upi requires a valid upi_id like name@bank';
  }
  return null;
}

router.get('/', requirePerm('billing.read'), async (_req, res) => {
  const rows = await query('SELECT * FROM system_payment_methods ORDER BY sort_order, created_at');
  res.json({ methods: rows });
});

router.post('/', requirePerm('billing.manage'), audit('created_payment_method', 'payment_method'), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() }); return; }
  const err = validateDetails(parsed.data.kind, parsed.data.chain ?? null, parsed.data.details as Record<string, unknown>);
  if (err) { res.status(422).json({ error: err }); return; }
  const { rows } = await getPool().query(
    `INSERT INTO system_payment_methods (kind, label, chain, details, is_active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [parsed.data.kind, parsed.data.label, parsed.data.chain ?? null, JSON.stringify(parsed.data.details), parsed.data.is_active ?? true, parsed.data.sort_order ?? 0],
  );
  res.status(201).json({ method: rows[0] });
});

router.patch('/:id', requirePerm('billing.manage'), audit('updated_payment_method', 'payment_method'), async (req, res) => {
  const cur = await query('SELECT * FROM system_payment_methods WHERE id=$1', [req.params.id]);
  if (!cur.length) { res.status(404).json({ error: 'not found' }); return; }
  const parsed = z.object({
    label: z.string().min(1).max(120).optional(),
    chain: z.enum(['TRC20', 'ERC20', 'BEP20', 'Polygon', 'Other']).nullable().optional(),
    details: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  const fields: string[] = []; const vals: unknown[] = []; let i = 1;
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    if (k === 'details') { fields.push(`details=$${i++}`); vals.push(JSON.stringify(v)); }
    else { fields.push(`${k}=$${i++}`); vals.push(v); }
  }
  if (!fields.length) { res.status(400).json({ error: 'nothing to update' }); return; }
  // validate merged
  const merged = { ...(cur[0] as Record<string, unknown>), ...parsed.data } as { kind: string; chain: string | null; details: Record<string, unknown> };
  const detailsObj = (merged.details as unknown) as Record<string, unknown>;
  // details may be JSON string from DB — parse if needed
  const det = typeof detailsObj === 'string' ? JSON.parse(detailsObj) as Record<string, unknown> : (detailsObj ?? {});
  const vErr = validateDetails(String(merged.kind), (merged.chain as string | null) ?? null, det);
  if (vErr) { res.status(422).json({ error: vErr }); return; }
  fields.push(`updated_at=now()`);
  vals.push(req.params.id);
  const { rows } = await getPool().query(`UPDATE system_payment_methods SET ${fields.join(', ')} WHERE id=$${i} RETURNING *`, vals);
  res.json({ method: rows[0] });
});

router.delete('/:id', requirePerm('billing.manage'), audit('deleted_payment_method', 'payment_method'), async (req, res) => {
  const r = await getPool().query('UPDATE system_payment_methods SET is_active=false, updated_at=now() WHERE id=$1', [req.params.id]);
  if (!r.rowCount) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ ok: true });
});

export default router;
