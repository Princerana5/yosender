import { Router } from 'express';
import { z } from 'zod';
import { query } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { encryptSecret } from './vendors.js';

const router = Router();

// ── Generic channel connectors (§23–§24): WhatsApp / RCS via provider APIs ──
router.get('/', async (_req, res) => {
  const rows = await query('SELECT id, name, channel, provider, status, tps, created_at, updated_at FROM channel_connectors ORDER BY created_at');
  res.json({ connectors: rows });
});

router.post('/', requirePerm('vendors.create'), audit('created_connector', 'channel_connector'), async (req, res) => {
  const parsed = z.object({
    name: z.string().min(1),
    channel: z.enum(['whatsapp', 'rcs']),
    provider: z.string().min(1),
    config: z.record(z.unknown()),
    tps: z.number().int().positive().default(20),
    status: z.enum(['enabled', 'disabled']).default('disabled'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const rows = await query(
    'INSERT INTO channel_connectors (name, channel, provider, config_enc, status, tps) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, channel, provider, status, tps',
    [parsed.data.name, parsed.data.channel, parsed.data.provider, encryptSecret(JSON.stringify(parsed.data.config)), parsed.data.status, parsed.data.tps],
  );
  res.status(201).json({ connector: rows[0] });
});

router.patch('/:id', requirePerm('vendors.update'), audit('updated_connector', 'channel_connector'), async (req, res) => {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of ['name', 'status', 'tps'] as const) {
    if (req.body?.[k] !== undefined) {
      params.push(req.body[k]);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (req.body?.config) {
    params.push(encryptSecret(JSON.stringify(req.body.config)));
    sets.push(`config_enc = $${params.length}`);
  }
  if (!sets.length) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  params.push(req.params.id);
  const rows = await query(
    `UPDATE channel_connectors SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}
     RETURNING id, name, channel, provider, status, tps`,
    params,
  );
  res.json({ connector: rows[0] ?? null });
});

export default router;
