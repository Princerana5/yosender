import { getPool } from '@8xtel/core';

export async function nextInvoiceNumber(now = new Date()): Promise<string> {
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cur = await db.query('SELECT next_seq FROM invoice_counters WHERE ym=$1 FOR UPDATE', [ym]);
    let seq: number;
    if (!cur.rowCount) {
      seq = 1;
      await db.query('INSERT INTO invoice_counters (ym, next_seq) VALUES ($1, 2)', [ym]);
    } else {
      seq = Number(cur.rows[0].next_seq);
      await db.query('UPDATE invoice_counters SET next_seq=$1 WHERE ym=$2', [seq + 1, ym]);
    }
    await db.query('COMMIT');
    return `INV-${ym}-${String(seq).padStart(4, '0')}`;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
