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
  submit: 'sms-submit',
  vendorSend: 'sms-vendor-send',
  dlr: 'sms-dlr',
  billing: 'sms-billing',
  clientDlr: 'sms-client-dlr',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

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

export function createWorker<T>(
  name: QueueName,
  processor: (job: { data: T; attemptsMade: number; name: string }) => Promise<void>,
  concurrency = 10,
): Worker {
  return new Worker(name, async (job) => processor(job as never), {
    connection: getRedis(),
    concurrency,
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

// ── Realtime counters for dashboard / live monitor (§3, §26) ────────────────
export async function incrStat(field: string, by = 1): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await getRedis().hincrby(`stats:${day}`, field, by);
}

export async function getDayStats(day?: string): Promise<Record<string, string>> {
  const d = day ?? new Date().toISOString().slice(0, 10);
  return getRedis().hgetall(`stats:${d}`);
}
