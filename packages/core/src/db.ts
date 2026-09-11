import { Pool, PoolConfig } from 'pg';

// ── PostgreSQL pool (persistent source of truth, §36) ───────────────────────
let pool: Pool | null = null;

export function getPool(config?: PoolConfig): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://xtel:xtel_secret@localhost:5432/xtelsmpp',
      max: Number(process.env.PG_POOL_MAX ?? 20),
      ...config,
    });
    pool.on('error', (err) => console.error('[pg] idle client error', err));
  }
  return pool;
}

export async function query<T = unknown>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows as T[];
}

export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
