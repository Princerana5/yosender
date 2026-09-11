import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '@8xtel/core';

// Runs *.sql in migrations/ in order. Idempotent via schema_migrations table.
async function main(): Promise<void> {
  const pool = getPool();
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())',
  );
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
    if (done.rowCount) {
      console.log(`skip ${f}`);
      continue;
    }
    console.log(`apply ${f}`);
    const sql = readFileSync(join(dir, f), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  }
  console.log('migrations complete');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
