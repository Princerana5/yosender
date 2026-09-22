import { createWorker, QUEUES, getPool, queryOne, incrStat, billsOnSubmit, billsOnDelivery, type BillingMode } from '@8xtel/core';

// ── Billing worker: mode-aware charging (§28, Phase 5) ───────────────────────
// Billing mode (stamped on messages at routing) decides WHEN the client pays:
//   on_submission      → charge at vendor accept (legacy behavior, default)
//   on_delivery        → charge only on delivered DLR (no submit charge)
//   submission_delivery→ submission component now + delivery component on DLR
//   operator_submission→ charge at vendor accept (operator accepted)
//   operator_delivery  → charge only on delivered DLR
//   hybrid             → submission component now + delivery component on DLR
//   on_attempt         → charge at route attempt (routing time)
//   on_accepted        → charge at platform accept (routing time)
// Idempotency: billing_charges PK = (message_id, component) — duplicate DLRs
// or retried jobs can never double-charge. billing_records stays the
// per-message revenue/cost summary (legacy consumers untouched).

interface ChargeJob {
  internal_id: string;
  client_id: string;
  vendor_id: string;
  client_price: string | null;
  billing_mode?: string | null;
  delivery_rate?: number | null;
  /** Which component this job bills: submission (default) or delivery. */
  component?: 'submission' | 'delivery';
}

function modeOf(v: unknown): BillingMode {
  const m = String(v ?? 'on_submission');
  return (['on_submission', 'on_delivery', 'submission_delivery', 'operator_submission',
    'operator_delivery', 'hybrid', 'on_attempt', 'on_accepted'] as const).includes(m as BillingMode)
    ? (m as BillingMode) : 'on_submission';
}

function eventFor(mode: BillingMode, component: 'submission' | 'delivery'): string {
  if (component === 'delivery') {
    return (mode === 'hybrid' || mode === 'operator_delivery') ? 'OPERATOR_DELIVERED' : 'DELIVERED';
  }
  switch (mode) {
    case 'operator_submission': case 'hybrid': return 'OPERATOR_SUBMITTED';
    case 'on_attempt': return 'ROUTE_ATTEMPT';
    case 'on_accepted': return 'ACCEPTED';
    default: return 'SUBMITTED';
  }
}

async function charge(job: { data: ChargeJob }): Promise<void> {
  const { internal_id, client_id, vendor_id } = job.data;
  const component = job.data.component ?? 'submission';
  let { client_price } = job.data;
  const pool = getPool();

  // Idempotency first: this (message, component) already billed → skip.
  const dup = await queryOne('SELECT 1 FROM billing_charges WHERE message_id=$1 AND component=$2', [internal_id, component]);
  if (dup) return;
  const legacy = await queryOne('SELECT message_id FROM billing_records WHERE message_id=$1', [internal_id]);
  if (legacy && component === 'submission') {
    // Legacy row exists (pre-mode traffic): backfill the charge row so the
    // ledger stays consistent, then stop — never double-bill.
    await pool.query(
      `INSERT INTO billing_charges (message_id, component, client_id, amount, billing_event)
       VALUES ($1,'submission',$2,COALESCE((SELECT client_price FROM billing_records WHERE message_id=$1),0),'SUBMITTED')
       ON CONFLICT DO NOTHING`, [internal_id, client_id],
    ).catch(() => undefined);
    return;
  }

  const msgRow = await queryOne<{
    billing_mode: string; destination: string; country_id: string | null;
    billing_currency: string | null; currency: string | null;
  }>(
    `SELECT m.billing_mode, m.destination, m.country_id, m.billing_currency, w.currency
     FROM messages m LEFT JOIN wallets w ON w.client_id=m.client_id WHERE m.id=$1`,
    [internal_id],
  );
  const mode = modeOf(job.data.billing_mode ?? msgRow?.billing_mode);
  const currency = msgRow?.billing_currency ?? msgRow?.currency ?? 'EUR';

  // Gate: submission jobs on delivery-only modes bill nothing (their charge
  // comes from the DLR path below). Delivery jobs on submit-only modes bill
  // nothing (already charged at submit).
  if (component === 'submission' && !billsOnSubmit(mode)) return;
  if (component === 'delivery' && !billsOnDelivery(mode)) return;

  // Amount: delivery component uses the split rate when configured,
  // otherwise the full client price.
  let price = Number(client_price ?? 0);
  if (component === 'delivery' && (mode === 'submission_delivery' || mode === 'hybrid')) {
    const split = job.data.delivery_rate;
    if (split !== null && split !== undefined && Number(split) > 0) price = Number(split);
  }

  const creditRow = await queryOne<{ reserved_credits: string; segments: number }>(
    'SELECT reserved_credits, segments FROM messages WHERE id=$1', [internal_id],
  );
  const creditHeld = component === 'submission' ? Number(creditRow?.reserved_credits ?? 0) : 0;

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
  const vendorCost = component === 'submission' ? Number(costRow?.cost ?? 0) : 0;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (creditHeld > 0) {
      await db.query(
        `INSERT INTO billing_records (message_id, client_id, vendor_id, client_price, vendor_cost)
         VALUES ($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
        [internal_id, client_id, vendor_id, vendorCost],
      );
      await db.query(
        'UPDATE messages SET vendor_cost=$1, reserved_amount=0, reserved_credits=0, credits_charged=$2 WHERE id=$3',
        [vendorCost, creditHeld, internal_id],
      );
      await db.query(
        `INSERT INTO billing_charges (message_id, component, client_id, amount, currency, billing_event)
         VALUES ($1,'submission',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [internal_id, client_id, creditHeld, currency, eventFor(mode, 'submission')],
      );
      await db.query(
        `UPDATE messages SET billed_amount=COALESCE(billed_amount,0)+$1,
           submission_billed_at=COALESCE(submission_billed_at,now()),
           billing_status=CASE WHEN billing_mode IN ('on_delivery','operator_delivery') THEN billing_status ELSE 'billed' END
         WHERE id=$2`, [creditHeld, internal_id],
      );
      await db.query('COMMIT');
      await incrStat('credits_burned', Math.round(creditHeld * 100));
      return;
    }
    // Money path: for delivery components there is no submit-time hold —
    // debit the amount now (balance check inside the UPDATE, fails safe).
    let debit = 0;
    if (component === 'submission') {
      const holdRow = await db.query('SELECT reserved_amount FROM messages WHERE id=$1 FOR UPDATE', [internal_id]);
      const held = Number(holdRow.rows[0]?.reserved_amount ?? 0);
      const diff = +(price - held).toFixed(6);
      if (diff === 0) {
        const cur = await db.query('SELECT balance FROM wallets WHERE client_id=$1', [client_id]);
        void cur;
      } else if (diff > 0) {
        const { rows } = await db.query(
          'UPDATE wallets SET balance = balance - $1, updated_at=now() WHERE client_id=$2 RETURNING balance',
          [diff, client_id],
        );
        await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [rows[0].balance, client_id]);
        await db.query(
          `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description)
           VALUES ($1,$2,'debit',$3,$4,$5)`,
          [client_id, internal_id, -diff, rows[0].balance, `SMS top-up charge ${internal_id.slice(0, 8)} (price ${price} > hold ${held})`],
        );
      } else {
        const { rows } = await db.query(
          'UPDATE wallets SET balance = balance + $1, updated_at=now() WHERE client_id=$2 RETURNING balance',
          [-diff, client_id],
        );
        await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [rows[0].balance, client_id]);
        await db.query(
          `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description)
           VALUES ($1,$2,'refund',$3,$4,$5)`,
          [client_id, internal_id, -diff, rows[0].balance, `SMS over-hold release ${internal_id.slice(0, 8)} (price ${price} < hold ${held})`],
        );
      }
    } else {
      // Delivery component: direct debit guarded by balance floor (prepay 0).
      const w = await db.query(
        `UPDATE wallets SET balance = balance - $1, updated_at=now()
         WHERE client_id=$2 AND balance - $1 >= 0 RETURNING balance`,
        [price, client_id],
      );
      if (!w.rowCount) {
        await db.query('ROLLBACK');
        await pool.query(
          `UPDATE messages SET billing_status='delivery_unpaid' WHERE id=$1`, [internal_id],
        ).catch(() => undefined);
        return;
      }
      debit = price;
      await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [w.rows[0].balance, client_id]);
      await db.query(
        `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description)
         VALUES ($1,$2,'debit',$3,$4,$5)`,
        [client_id, internal_id, -price, w.rows[0].balance, `SMS delivery charge ${internal_id.slice(0, 8)} (${mode})`],
      );
    }
    void debit;
    await db.query(
      `INSERT INTO billing_records (message_id, client_id, vendor_id, client_price, vendor_cost)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [internal_id, client_id, vendor_id, price, vendorCost],
    );
    if (component === 'delivery') {
      // Accumulate onto the existing record (submission part already there).
      await db.query(
        `UPDATE billing_records SET client_price = client_price + $1 WHERE message_id=$2`, [price, internal_id],
      );
    }
    await db.query(
      `INSERT INTO billing_charges (message_id, component, client_id, amount, currency, billing_event)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [internal_id, component, client_id, price, currency, eventFor(mode, component)],
    );
    await db.query(
      component === 'submission'
        ? `UPDATE messages SET vendor_cost=$1, reserved_amount=0, billed_amount=COALESCE(billed_amount,0)+$2,
             submission_billed_at=now(),
             operator_submission_billed_at=CASE WHEN billing_mode IN ('operator_submission','hybrid') THEN now() ELSE operator_submission_billed_at END,
             billing_status=CASE WHEN billing_mode IN ('on_delivery','operator_delivery') THEN billing_status ELSE 'billed' END
           WHERE id=$3`
        : `UPDATE messages SET billed_amount=COALESCE(billed_amount,0)+$2, delivery_billed_at=now(),
             operator_delivery_billed_at=CASE WHEN billing_mode IN ('operator_delivery','hybrid') THEN now() ELSE operator_delivery_billed_at END,
             billing_status='billed' WHERE id=$3`,
      component === 'submission' ? [vendorCost, price, internal_id] : [price, price, internal_id],
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
