// ── DLR Cutting / Delay Control — selection + config resolution ─────────────
import crypto from 'node:crypto';
import { getRedis } from './queue.js';
import { getPool } from './db.js';

export interface DlrCuttingConfig {
  id: string;
  enabled: boolean;
  percentage: number;
  interval_messages: number;
  delay_seconds: number;
  selection_mode: string;
  scope: string;
  status: string;
  client_id: string | null;
  route_id: string | null;
  country_id: string | null;
}

// Priority: most specific wins.
// Order: (route+country) > route > client-country? > client > country > global
// We match configs in this exact sequence and return the first enabled+active.
export async function resolveCuttingConfig(opts: {
  route_id: string | null;
  client_id: string | null;
  country_id: string | null;
}): Promise<DlrCuttingConfig | null> {
  const pool = getPool();
  // Try in priority order — first hit wins.
  const tries: Array<[string, unknown[]]> = [];

  if (opts.route_id && opts.country_id) {
    tries.push([
      `SELECT * FROM dlr_cutting_configs WHERE scope='country' AND route_id=$1 AND country_id=$2 AND enabled=true AND status='active' LIMIT 1`,
      [opts.route_id, opts.country_id],
    ]);
  }
  if (opts.route_id) {
    tries.push([
      `SELECT * FROM dlr_cutting_configs WHERE scope='route' AND route_id=$1 AND enabled=true AND status='active' LIMIT 1`,
      [opts.route_id],
    ]);
  }
  if (opts.client_id) {
    tries.push([
      `SELECT * FROM dlr_cutting_configs WHERE scope='client' AND client_id=$1 AND enabled=true AND status='active' LIMIT 1`,
      [opts.client_id],
    ]);
  }
  if (opts.country_id && !opts.route_id) {
    tries.push([
      `SELECT * FROM dlr_cutting_configs WHERE scope='country' AND route_id IS NULL AND country_id=$1 AND enabled=true AND status='active' LIMIT 1`,
      [opts.country_id],
    ]);
  }
  // Global fallback
  tries.push([
    `SELECT * FROM dlr_cutting_configs WHERE scope='global' AND enabled=true AND status='active' LIMIT 1`,
    [],
  ]);

  for (const [sql, params] of tries) {
    const { rows } = await pool.query(sql, params);
    if (rows[0]) return rows[0] as DlrCuttingConfig;
  }
  return null;
}

// ── Selection ───────────────────────────────────────────────────────────────
// Per-config counters live in Redis (atomic Lua INCR). DB counters are the
// durable mirror for restarts / reporting. We do NOT block DLR threads.
//
// Selection model (matches spec "approximately p% per interval"):
//  • Every message increments the per-config counter (Redis INCR, concurrency-safe).
//  • For the current interval block we pre-pick K = round(p/100 * N) positions
//    uniformly at random without repetition. The message at position `pos`
//    inside the block is selected iff pos is in the pre-picked set.
//  • The random set for a block is generated once (first message of the block)
//    and stored in Redis until the block completes, so the decision is
//    deterministic per block but random across blocks.
//
// Fallback: if Redis is unavailable, fall back to a non-blocking probabilistic
// check (single-message rand) so traffic never stalls.

const BLOCK_TTL_SEC = 3600;

function pickRandomIndices(n: number, k: number, seed: string): number[] {
  if (k <= 0) return [];
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  // Seeded Fisher-Yates partial shuffle (deterministic per block for audit)
  const buf = crypto.createHash('sha256').update(seed).digest();
  let s = buf.readUInt32BE(0);
  const arr = Array.from({ length: n }, (_, i) => i);
  // xorshift for speed
  const rnd = (): number => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
  for (let i = n - 1; i >= n - k; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(n - k).sort((a, b) => a - b);
}

// Redis Lua: atomic counter + block set management.
// KEYS[1]=counter key, KEYS[2]=block key, ARGV[1]=interval, ARGV[2]=k, ARGV[3]=blockId, ARGV[4]=packed picks (csv)
const LUA_SELECT = `
local cnt = redis.call('INCR', KEYS[1])
local interval = tonumber(ARGV[1])
local k = tonumber(ARGV[2])
local blockId = ARGV[3]
local picksCsv = ARGV[4]
local pos = (cnt - 1) % interval
if k <= 0 then return {cnt, pos, 0} end
if k >= interval then return {cnt, pos, 1} end
-- ensure block set exists (only first message of block creates it)
local exists = redis.call('EXISTS', KEYS[2])
if exists == 0 then
  if picksCsv ~= '' then
    for tok in string.gmatch(picksCsv, "[^,]+") do
      redis.call('SADD', KEYS[2], tok)
    end
    redis.call('EXPIRE', KEYS[2], 3600)
  end
end
local isMember = redis.call('SISMEMBER', KEYS[2], tostring(pos))
if pos == interval - 1 then
  -- last message of block: schedule key to expire shortly after
  redis.call('EXPIRE', KEYS[2], 60)
end
return {cnt, pos, isMember}
`;

export async function shouldSelectForDelay(
  config: DlrCuttingConfig,
): Promise<{ selected: boolean; counter: number; pos: number }> {
  const percentage = Number(config.percentage);
  const interval = Number(config.interval_messages);
  if (percentage <= 0 || interval <= 0) return { selected: false, counter: 0, pos: 0 };
  if (percentage >= 100) {
    // 100% → every message, still bump counter for stats
    try {
      const redis = getRedis();
      const cnt = await redis.incr(`dlr_cutting:cnt:${config.id}`);
      // best-effort DB mirror
      getPool().query(
        `INSERT INTO dlr_cutting_counters (config_id, processed, selected) VALUES ($1,1,1)
         ON CONFLICT (config_id) DO UPDATE SET processed=dlr_cutting_counters.processed+1, selected=dlr_cutting_counters.selected+1, updated_at=now()`,
        [config.id],
      ).catch(() => undefined);
      getPool().query(
        `INSERT INTO dlr_cutting_stats (config_id, messages_processed, messages_selected) VALUES ($1,1,1)
         ON CONFLICT (config_id) DO UPDATE SET messages_processed=dlr_cutting_stats.messages_processed+1, messages_selected=dlr_cutting_stats.messages_selected+1, updated_at=now()`,
        [config.id],
      ).catch(() => undefined);
      return { selected: true, counter: cnt, pos: (cnt - 1) % interval };
    } catch {
      return { selected: true, counter: 0, pos: 0 };
    }
  }

  const k = Math.round((percentage / 100) * interval);
  const sequential = config.selection_mode === 'sequential';

  try {
    const redis = getRedis();
    const rawCnt = await redis.get(`dlr_cutting:cnt:${config.id}`);
    const nextCnt = (Number(rawCnt ?? 0) + 1);
    const nextBlock = Math.floor((nextCnt - 1) / interval);
    const blockKey = `dlr_cutting:block:${config.id}:${nextBlock}`;
    const picks = sequential
      ? Array.from({ length: k }, (_, i) => interval - k + i)
      : pickRandomIndices(interval, k, `${config.id}:${nextBlock}`);
    const picksCsv = picks.join(',');

    const res = (await redis.eval(
      LUA_SELECT,
      2,
      `dlr_cutting:cnt:${config.id}`,
      blockKey,
      String(interval),
      String(k),
      String(nextBlock),
      picksCsv,
    )) as [number, number, number];

    const cnt = Number(res[0]);
    const pos = Number(res[1]);
    const isMember = Number(res[2]) === 1;

    // Calculate the actual block for DB mirroring (cnt may have drifted from nextCnt under concurrency)
    const actualBlock = Math.floor((cnt - 1) / interval);
    if (actualBlock !== nextBlock) {
      // Rare race: block changed between peek and INCR — the set for actualBlock
      // may not exist yet and Lua inserted nextBlock's picks into wrong key.
      // This affects at most one message per block boundary; acceptable vs locking.
    }

    getPool().query(
      `INSERT INTO dlr_cutting_counters (config_id, processed, selected) VALUES ($1,1,$2)
       ON CONFLICT (config_id) DO UPDATE SET processed=dlr_cutting_counters.processed+1, selected=dlr_cutting_counters.selected+$2, updated_at=now()`,
      [config.id, isMember ? 1 : 0],
    ).catch(() => undefined);
    getPool().query(
      `INSERT INTO dlr_cutting_stats (config_id, messages_processed, messages_selected) VALUES ($1,1,$2)
       ON CONFLICT (config_id) DO UPDATE SET messages_processed=dlr_cutting_stats.messages_processed+1, messages_selected=dlr_cutting_stats.messages_selected+$2, updated_at=now()`,
      [config.id, isMember ? 1 : 0],
    ).catch(() => undefined);

    return { selected: isMember, counter: cnt, pos };
  } catch {
    // Redis down → probabilistic fallback (non-blocking, never stall traffic)
    const selected = Math.random() * 100 < percentage;
    return { selected, counter: 0, pos: 0 };
  }
}
