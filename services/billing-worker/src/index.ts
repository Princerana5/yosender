import { createWorker, QUEUES, getPool, queryOne, incrStat } from '@8xtel/core';

// ── Billing worker: charge on vendor accept, refund on total failure (§28, Phase 5)
// Idempotent per message (billing_records PK = message_id). Ledger immutable.

interface ChargeJob {
  internal_id: string;
  client_id: string;
  vendor_id: string;
  client_price: string | null;
}

async function charge(job: { data: ChargeJob }): Promise<void> {
  const { internal_id, client_id, vendor_id } = job.data;
  let { client_price } = job.data;
  const pool = getPool();

  const exists = await queryOne('SELECT message_id FROM billing_records WHERE message_id=$1', [internal_id]);
  if (exists) return; // idempotent (§37)

  // Resolve vendor cost: longest prefix / country match
  const msg = await queryOne<{ destination: string; country_id: string | null }>(
    'SELECT destination, country_id FROM messages WHERE id=$1', [internal_id],
  );
  const digits = (msg?.destination ?? '').replace(/\D/g, '');
  const costRow = await queryOne<{ cost: string }>(
    `SELECT cost FROM vendor_rates WHERE vendor_id=$1
       AND ($2 LIKE COALESCE(prefix,'') || '%' OR country_id=$3)
     ORDER BY length(COALESCE(prefix,'')) DESC LIMIT 1`,
    [vendor_id, digits, msg?.country_id ?? null],
  );
  const vendorCost = Number(costRow?.cost ?? 0);
  const price = Number(client_price ?? 0);

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Debit client wallet (balance may go negative up to credit_limit — checked at bind/submit)
    const { rows } = await db.query(
      'UPDATE wallets SET balance = balance - $1, updated_at=now() WHERE client_id=$2 RETURNING balance',
      [price, client_id],
    );
    const balanceAfter = rows[0]?.balance ?? 0;
    await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [balanceAfter, client_id]);
    await db.query(
      `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description)
       VALUES ($1,$2,'debit',$3,$4,$5)`,
      [client_id, internal_id, -price, balanceAfter, `SMS ${internal_id.slice(0, 8)}`],
    );
    await db.query(
      `INSERT INTO billing_records (message_id, client_id, vendor_id, client_price, vendor_cost)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [internal_id, client_id, vendor_id, price, vendorCost],
    );
    await db.query(
      'UPDATE messages SET vendor_cost=$1 WHERE id=$2', [vendorCost, internal_id],
    );
    await db.query('COMMIT');
    await incrStat('revenue_x1000', Math.round(price * 1000));
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
  void client_price;
}

async function refund(job: { data: { internal_id: string; client_id: string } }): Promise<void> {
  const { internal_id, client_id } = job.data;
  const pool = getPool();
  const rec = await queryOne<{ client_price: string }>(
    'SELECT client_price FROM billing_records WHERE message_id=$1', [internal_id],
  );
  if (!rec) return; // never charged
  const amount = Number(rec.client_price);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      'UPDATE wallets SET balance = balance + $1, updated_at=now() WHERE client_id=$2 RETURNING balance',
      [amount, client_id],
    );
    await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [rows[0].balance, client_id]);
    await db.query(
      `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description)
       VALUES ($1,$2,'refund',$3,$4,$5)`,
      [client_id, internal_id, amount, rows[0].balance, `Refund ${internal_id.slice(0, 8)} (all vendors failed)`],
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function main(): Promise<void> {
  createWorker(QUEUES.billing, async (job) => {
    if (job.name === 'refund') await refund(job as never);
    else await charge(job as never);
  }, 20);
  console.log('[8xtelSMPP billing-worker] started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
