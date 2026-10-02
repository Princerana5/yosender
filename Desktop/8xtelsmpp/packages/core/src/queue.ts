import IORedis from 'ioredis';
import { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';

// ── Redis + BullMQ queues (§36) ─────────────────────────────────────────────
// Queues: submit (client→routing), vendor_send (routing→vendor),
//         dlr (vendor→dlr worker), billing (charges), client_dlr (→client)

let connection: IORedis | null = null;

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
      { maxRetriesPerRequest: null, enableReadyCheck: false },
    );
    connection.on('error', (e) => console.error('[redis]', e.message));
  }
  return connection;
}

export const QUEUES = {
  submit: 'sms-submit', // fast lane (singletons, interactive pushes)
  submitBulk: 'sms-submit-bulk', // bulk lane (campaigns / bursty blasts)
  vendorSend: 'sms-vendor-send',
  dlr: 'sms-dlr',
  billing: 'sms-billing',
  // Split fan-out: SMPP receipts must reach smpp-server (it owns the live
  // client sockets) and HTTP callbacks must reach dlr-worker. Sharing one
  // queue let each consumer steal — and silently drop — the other's jobs.
  clientDlr: 'sms-client-dlr', // SMPP deliver_sm → smpp-server ONLY
  clientDlrHttp: 'sms-client-dlr-http', // HTTP callbacks → dlr-worker ONLY
  dlrDelay: 'sms-dlr-delay', // delayed DLR release queue (§39)
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// RCS has independent queues and workers; it never consumes SMS jobs.
export const RCS_QUEUES = {
  submit: 'rcs-submit',
  campaign: 'rcs-campaign',
  route: 'rcs-route',
  vendorSend: 'rcs-vendor-send',
  webhook: 'rcs-webhook',
  billing: 'rcs-billing',
  clientDlr: 'rcs-client-dlr',
  deadLetter: 'rcs-dead-letter',
} as const;

export type RcsQueueName = (typeof RCS_QUEUES)[keyof typeof RCS_QUEUES];

const queues = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 }, // §37
        removeOnComplete: 1000,
        removeOnFail: 5000,
      } satisfies JobsOptions,
    });
    queues.set(name, q);
  }
  return q;
}

export function getRcsQueue(name: RcsQueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      } satisfies JobsOptions,
    });
    queues.set(name, q);
  }
  return q;
}

export function getAnyRcsQueue(name: string): Queue {
  if (!(Object.values(RCS_QUEUES) as string[]).includes(name)) {
    throw new Error(`unknown RCS queue: ${name}`);
  }
  return getRcsQueue(name as RcsQueueName);
}

export function createWorker<T>(
  name: string,
  processor: (job: { data: T; attemptsMade: number; name: string }) => Promise<void>,
  concurrency = 10,
  opts: { lockDuration?: number; stalledInterval?: number; maxStalledCount?: number } = {},
): Worker {
  return new Worker(name, async (job) => processor(job as never), {
    connection: getRedis(),
    concurrency,
    // Jobs that stall past the lock (slow vendor RTT under load) get re-run
    // as duplicates — 60s headroom keeps high-TPS bursts idempotent-safe.
    lockDuration: opts.lockDuration ?? 60_000,
    // Stalled-job guard: BullMQ's stalled-check reclaims a job whose worker
    // died WITHOUT completing it. Default maxStalledCount=1 + attempts=0 on
    // requeued jobs = killed on the FIRST stall with no retry, leaving the
    // message `submitted` forever (seen live Sept 2026: 8k stuck rows, zero
    // worker errors). Generous settings: only truly dead jobs are reaped.
    stalledInterval: opts.stalledInterval ?? 60_000,
    maxStalledCount: opts.maxStalledCount ?? 3,
  });
}

export function queueEvents(name: QueueName): QueueEvents {
  return new QueueEvents(name, { connection: getRedis() });
}

// ── Sliding-window TPS limiter (Redis) ──────────────────────────────────────
export async function checkTps(
  key: string,
  limit: number,
  windowSec = 1,
): Promise<boolean> {
  if (limit <= 0) return true;
  const redis = getRedis();
  const now = Date.now();
  const member = `${now}:${Math.random().toString(36).slice(2)}`;
  const windowStart = now - windowSec * 1000;
  const k = `tps:${key}`;
  const pipe = redis.pipeline();
  pipe.zremrangebyscore(k, 0, windowStart);
  pipe.zadd(k, now, member);
  pipe.zcard(k);
  pipe.expire(k, windowSec + 1);
  const [, , [ , count ]] = (await pipe.exec()) as unknown as [unknown, unknown, [unknown, number]];
  return count <= limit;
}

// ── Non-filling TPS acquire (Lua, atomic) ─────────────────────────────────────
// Like checkTps, but a DENIED attempt leaves NO entry behind. Required for
// bulk pacing loops: with hundreds of jobs retrying, the filling variant
// saturates its own window (every denied check adds an entry) and deadlocks —
// nothing ever passes again. This one only records actual admissions.
export async function tryAcquireTps(
  key: string,
  limit: number,
  windowSec = 1,
): Promise<boolean> {
  if (limit <= 0) return true;
  const redis = getRedis();
  const now = Date.now();
  const member = `${now}:${Math.random().toString(36).slice(2)}`;
  const res = (await redis.eval(
    `redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
     local n = redis.call('ZCARD', KEYS[1])
     if n < tonumber(ARGV[2]) then
       redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
       redis.call('EXPIRE', KEYS[1], ARGV[5])
       return 1
     else
       return 0
     end`,
    1,
    `tps:${key}`,
    String(now - windowSec * 1000),
    String(limit),
    String(now),
    member,
    String(windowSec + 1),
  )) as number;
  return res === 1;
}

// ── Submit lane routing (fast vs per-client bulk) ──────────────────────────
// Fast lane (sms-submit) — singleton / interactive pushes, always instant.
// Bulk lane — sharded per client (sms-submit-bulk:<clientId>) so that
// 5 clients each blasting 10k never block each other. Each client gets
// its own FIFO and its own share of workers (fair — round-robin).
export function isBulkSubmitJob(data: unknown): boolean {
  return Boolean((data as { _bulk?: boolean })?._bulk);
}

export function bulkQueueName(clientId: string): string {
  return `${QUEUES.submitBulk}-${clientId}`;
}

export function submitQueueFor(data: unknown): string {
  if (!isBulkSubmitJob(data)) return QUEUES.submit;
  const cid = (data as { client_id?: string })?.client_id;
  return cid ? bulkQueueName(cid) : QUEUES.submitBulk;
}

// Bulk queues are per-client (dynamic names) — not in the QUEUES enum.
// This helper creates/reuses them with the same defaults as getQueue.
const bulkQueues = new Map<string, Queue>();
export function getBulkQueue(clientId: string): Queue {
  const name = bulkQueueName(clientId);
  let q = bulkQueues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      } satisfies JobsOptions,
    });
    bulkQueues.set(name, q);
  }
  return q;
}

// All queue names (static + dynamic) for helpers like getQueue
export function getAnyQueue(name: string): Queue {
  if (name === QUEUES.submit || name === QUEUES.vendorSend || name === QUEUES.dlr
    || name === QUEUES.billing || name === QUEUES.clientDlr || name === QUEUES.clientDlrHttp
    || name === QUEUES.dlrDelay) return getQueue(name as QueueName);
  if (name.startsWith(`${QUEUES.submitBulk}-`)) {
    const cid = name.slice(QUEUES.submitBulk.length + 1);
    return getBulkQueue(cid);
  }
  if (name === QUEUES.submitBulk) return getQueue(QUEUES.submitBulk);
  return getQueue(name as QueueName);
}

// Requeue helper that preserves the originating lane/client shard.
export async function requeueSubmit(data: unknown, opts: { delay?: number; jobId?: string } = {}): Promise<void> {
  const qName = submitQueueFor(data);
  const q = qName.startsWith(`${QUEUES.submitBulk}-`)
    ? getBulkQueue((data as { client_id: string }).client_id)
    : getQueue(qName as QueueName);
  await q.add('submit', data as never, { delay: opts.delay, jobId: opts.jobId });
}

// Track active bulk clients for the fair dispatcher
export async function trackBulkClient(clientId: string): Promise<void> {
  await getRedis().sadd('bulk:clients', clientId);
}

// ── Realtime counters for dashboard / live monitor (§3, §26) ────────────────
export async function incrStat(field: string, by = 1): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await getRedis().hincrby(`stats:${day}`, field, by);
}

export async function getDayStats(day?: string): Promise<Record<string, string>> {
  const d = day ?? new Date().toISOString().slice(0, 10);
  return getRedis().hgetall(`stats:${d}`);
}
