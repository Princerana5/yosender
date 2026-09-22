import { Router } from 'express';
import { getPool, getRedis } from '@8xtel/core';

// ── Public pipeline watchdog (NO auth — counts only, no content/PII) ─────────
// Mounted at /system/health by index.ts WITHOUT requireAuth so the local
// cron watchdog + load balancer can poll without a JWT. Returns queue depths
// + stuck-message ages; anything non-ok means "look now".
// Thresholds: warn at 100 queued or 5-min-old stuck; critical at 1000 / 15 min.
const router = Router();

router.get('/', async (_req, res) => {
  res.json({ status: 'ok', service: '8xtelSMPP-api', time: new Date().toISOString() });
});

router.get('/pipeline', async (_req, res) => {
  const redis = getRedis();
  const queues = ['sms-submit', 'sms-vendor-send', 'sms-dlr', 'sms-billing', 'sms-client-dlr', 'sms-client-dlr-http'];
  const depths: Record<string, { wait: number; active: number }> = {};
  let redisOk = true;
  for (const q of queues) {
    try {
      const [wait, active] = await Promise.all([
        redis.llen(`bull:${q}:wait`).catch(() => -1),
        redis.llen(`bull:${q}:active`).catch(() => -1),
      ]);
      depths[q] = { wait, active };
    } catch {
      redisOk = false;
      depths[q] = { wait: -1, active: -1 };
    }
  }
  let pgOk = true;
  let noVendor: { count: string; oldest: string | null } = { count: '0', oldest: null };
  let noDlr: { count: string; oldest: string | null } = { count: '0', oldest: null };
  try {
    const pool = getPool();
    const nv = await pool.query(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM messages
       WHERE status='submitted' AND vendor_id IS NULL`,
    ).then((r) => (r.rows as Array<{ count: string; oldest: string | null }>)[0]);
    const nd = await pool.query(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM messages
       WHERE status='submitted' AND vendor_id IS NOT NULL
         AND created_at > now() - interval '48 hours'`,
    ).then((r) => (r.rows as Array<{ count: string; oldest: string | null }>)[0]);
    if (nv) noVendor = nv;
    if (nd) noDlr = nd;
  } catch {
    pgOk = false;
  }
  const ageMin = (iso: string | null): number | null =>
    iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;
  const nvAge = ageMin(noVendor.oldest);
  const ndAge = ageMin(noDlr.oldest);
  const totalQueued = Object.values(depths).reduce((s, d) => s + Math.max(0, d.wait), 0);
  const problems: string[] = [];
  if (!redisOk) problems.push('redis unreachable');
  if (!pgOk) problems.push('postgres unreachable');
  if (totalQueued >= 1000) problems.push(`backlog critical: ${totalQueued} queued`);
  else if (totalQueued >= 100) problems.push(`backlog warning: ${totalQueued} queued`);
  if (nvAge !== null && nvAge >= 15) problems.push(`routing stall: ${noVendor.count} unrouted, oldest ${nvAge}m`);
  else if (nvAge !== null && nvAge >= 5) problems.push(`routing slow: ${noVendor.count} unrouted, oldest ${nvAge}m`);
  if (ndAge !== null && ndAge >= 60) problems.push(`vendor DLR silence: ${noDlr.count} awaiting DLR, oldest ${ndAge}m`);
  const status = problems.some((p) => /critical|stall|unreachable/.test(p))
    ? 'critical'
    : problems.length ? 'warning' : 'ok';
  res.status(status === 'ok' ? 200 : status === 'warning' ? 200 : 503).json({
    status,
    time: new Date().toISOString(),
    queues: depths,
    stuck_no_vendor: { count: Number(noVendor.count), oldest_age_min: nvAge },
    stuck_awaiting_dlr: { count: Number(noDlr.count), oldest_age_min: ndAge },
    problems,
  });
});

export default router;
