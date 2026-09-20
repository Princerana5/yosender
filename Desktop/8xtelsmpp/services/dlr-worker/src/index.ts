import {
  createWorker, getQueue, QUEUES, getPool, queryOne,
  mapDlrStatus, parseDlrBody, incrStat,
} from '@8xtel/core';

// ── DLR worker: sms:dlr → map → store (immutable raw) → client delivery (§16–17, Phase 4)
// Duplicate DLR protection: UNIQUE(message_id) + status-finality guard (§37).

interface IncomingDlr {
  vendor_id: string;
  body: string;
  source: string;
  received_at: string;
  /** Internal message id this DLR was polled for (HTTP poller sets it).
      Vendors that reuse one msgid across sends/numbers (Fortius) need this
      to disambiguate — msgid alone can match a sibling row. */
  internal_id?: string;
  /** Destination the poller matched on — second disambiguator. */
  destination?: string;
}

const FINAL = new Set(['delivered', 'undelivered', 'expired', 'rejected', 'failed']);

async function handleJob(job: { data: IncomingDlr }): Promise<void> {
  const { vendor_id, body } = job.data;
  const pool = getPool();
  const { vendor_msg_id, stat } = parseDlrBody(body);
  const vendorStatus = mapDlrStatus(stat);

  // 1. Direct hit: the poller already resolved WHICH message this DLR is for.
  let msg: {
    id: string; client_id: string; status: string; source: string;
    destination: string; dlr_mode: string; dlr_callback_url: string | null;
  } | null = null;
  if (job.data.internal_id) {
    msg = await queryOne<{
      id: string; client_id: string; status: string; source: string;
      destination: string; dlr_mode: string; dlr_callback_url: string | null;
    }>(
      `SELECT m.id, m.client_id, m.status, m.source, m.destination, c.dlr_mode, c.dlr_callback_url
       FROM messages m JOIN clients c ON c.id=m.client_id
       WHERE m.id=$1 AND m.vendor_id=$2`,
      [job.data.internal_id, vendor_id],
    );
  }
  // 2. Fallback: msgid lookup. Prefer a NON-final row for the same
  // destination (reused msgids must not land on an already-settled sibling),
  // then any non-final row, then newest overall (legacy behavior).
  if (!msg && vendor_msg_id) {
    const dest = job.data.destination ?? null;
    msg = await queryOne<{
      id: string; client_id: string; status: string; source: string;
      destination: string; dlr_mode: string; dlr_callback_url: string | null;
    }>(
      `SELECT m.id, m.client_id, m.status, m.source, m.destination, c.dlr_mode, c.dlr_callback_url
       FROM messages m JOIN clients c ON c.id=m.client_id
       WHERE m.vendor_msg_id=$1 AND m.vendor_id=$2
       ORDER BY
         CASE WHEN m.status='submitted' AND ($3::text IS NULL OR m.destination=$3) THEN 0
              WHEN m.status='submitted' THEN 1
              ELSE 2 END,
         m.created_at DESC LIMIT 1`,
      [vendor_msg_id, vendor_id, dest],
    );
  }

  if (!msg) {
    console.warn(`[dlr] orphan DLR from vendor ${vendor_id}: ${body.slice(0, 120)}`);
    await incrStat('dlr_orphan');
    return;
  }

  // Unrecognized vendor status → keep raw for audit, but NEVER surface
  // 'unknown' to the panel/client as a message status. The message stays
  // `submitted` so HTTP polling keeps retrying and the next real DLR settles it.
  if (vendorStatus === 'unknown') {
    await pool.query(
      `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'dlr',$3)`,
      [msg.id, vendor_id, `unrecognized stat ignored: ${body.slice(0, 120)}`],
    ).catch(() => undefined);
    await incrStat('dlr_unknown');
    return;
  }

  // Duplicate / late DLR after final state → keep raw, don't regress (§37)
  if (FINAL.has(msg.status)) {
    await pool.query(
      `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'dlr',$3)
       ON CONFLICT DO NOTHING`,
      [msg.id, vendor_id, `duplicate ${vendorStatus} ignored (final=${msg.status})`],
    ).catch(() => undefined);
    return;
  }

  // Client-visible status always mirrors the vendor outcome (§19: raw NEVER
  // rewritten). Previously a 'sampled' traffic policy randomly flipped ~2% of
  // delivered messages to undelivered — removed: it lied on delivered traffic,
  // triggered wrongful refunds, and sent false client callbacks.
  const clientStatus = vendorStatus;

  await pool.query(
    `INSERT INTO dlrs (message_id, vendor_msg_id, raw_body, vendor_status, client_status, delivered_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $4='delivered' THEN now() ELSE NULL END)
     ON CONFLICT (message_id) DO UPDATE SET
       raw_body=EXCLUDED.raw_body, vendor_status=EXCLUDED.vendor_status,
       client_status=EXCLUDED.client_status,
       delivered_at=COALESCE(EXCLUDED.delivered_at, dlrs.delivered_at)`,
    [msg.id, vendor_msg_id, body, vendorStatus, clientStatus],
  );
  await pool.query(
    'UPDATE messages SET status=$1, dlr_time=now(), error_code=$2 WHERE id=$3',
    [clientStatus, vendorStatus === 'delivered' ? null : 'vendor:' + vendorStatus, msg.id],
  );

  // ── Settlement: release the submit-time hold on non-delivered outcomes ────
  // Delivered → hold stands (billing worker converts it to the real charge).
  // Anything else → refund the hold so the client only pays for delivered SMS.
  // Credit-mode messages refund sms_credits instead of money (same shape).
  if (clientStatus !== 'delivered') {
    const creditHold = await queryOne<{ reserved_credits: string; client_id: string }>(
      'SELECT reserved_credits, client_id FROM messages WHERE id=$1', [msg.id],
    );
    const credits = Number(creditHold?.reserved_credits ?? 0);
    if (credits > 0) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const w = await db.query(
          'SELECT sms_credits FROM wallets WHERE client_id=$1 FOR UPDATE', [creditHold!.client_id],
        );
        const after = +(Number(w.rows[0].sms_credits ?? 0) + credits).toFixed(2);
        await db.query('UPDATE wallets SET sms_credits=$1, updated_at=now() WHERE client_id=$2', [after, creditHold!.client_id]);
        await db.query('UPDATE clients SET sms_credits=$1 WHERE id=$2', [after, creditHold!.client_id]);
        await db.query(
          `INSERT INTO credit_transactions (client_id, message_id, type, amount, balance_after, description, remark)
           VALUES ($1,$2,'refund',$3,$4,$5,$6)`,
          [creditHold!.client_id, msg.id, credits, after,
           `Release credit hold ${msg.id.slice(0, 8)} (${clientStatus})`,
           `Credits released — outcome ${clientStatus}`],
        );
        await db.query('UPDATE messages SET reserved_credits=0 WHERE id=$1', [msg.id]);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        db.release();
      }
    }
    const hold = await queryOne<{ reserved_amount: string; client_id: string }>(
      'SELECT reserved_amount, client_id FROM messages WHERE id=$1', [msg.id],
    );
    const amount = Number(hold?.reserved_amount ?? 0);
    if (amount > 0) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const w = await db.query(
          'SELECT balance, currency FROM wallets WHERE client_id=$1 FOR UPDATE', [hold!.client_id],
        );
        const after = Number(w.rows[0].balance) + amount;
        await db.query('UPDATE wallets SET balance=$1, updated_at=now() WHERE client_id=$2', [after, hold!.client_id]);
        await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [after, hold!.client_id]);
        await db.query(
          `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description, remark, currency)
           VALUES ($1,$2,'refund',$3,$4,$5,$6,$7)`,
          [hold!.client_id, msg.id, amount, after,
           `Release hold ${msg.id.slice(0, 8)} (${clientStatus})`,
           `Hold released — outcome ${clientStatus}`, w.rows[0].currency],
        );
        await db.query('UPDATE messages SET reserved_amount=0 WHERE id=$1', [msg.id]);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        db.release();
      }
    }
  }
  await pool.query(
    'INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,$3,$4)',
    [msg.id, vendor_id, 'dlr', `vendor=${vendorStatus} client=${clientStatus}`],
  );
  await pool.query(
    'UPDATE vendor_connections SET dlr_count = dlr_count + 1 WHERE vendor_id=$1',
    [vendor_id],
  );
  await incrStat(`dlr_${clientStatus}`);

  // Fan out to client (§17) — separate queues per transport so the SMPP
  // consumer (smpp-server) and the HTTP consumer (this worker) never steal
  // each other's jobs. 'none' = panel-only (no push), but the panel + status
  // API already read messages.status so the client still sees realtime state.
  if (msg.dlr_mode === 'none') {
    return;
  }
  if (msg.dlr_mode === 'smpp') {
    await getQueue(QUEUES.clientDlr).add('client-dlr', {
      internal_id: msg.id,
      client_id: msg.client_id,
      vendor_msg_id,
      status: clientStatus,
      error_code: null,
      error_description: null,
      raw_body: body,
      delivered_at: new Date().toISOString(),
      source: msg.source,
      destination: msg.destination,
    });
  } else if ((msg.dlr_mode === 'http' || msg.dlr_mode === 'api') && msg.dlr_callback_url) {
    await getQueue(QUEUES.clientDlrHttp).add('http-callback', {
      url: msg.dlr_callback_url,
      internal_id: msg.id,
      status: clientStatus,
      vendor_msg_id,
    });
  }
}

// HTTP-callback delivery (retried with backoff by BullMQ, §37)
async function processClientDlr(job: { data: Record<string, unknown> }): Promise<void> {
  const d = job.data as { url?: string; internal_id: string; status: string; vendor_msg_id?: string };
  if (!d.url) return; // smpp-mode handled by smpp-server consumer
  const res = await fetch(d.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message_id: d.internal_id,
      vendor_msg_id: d.vendor_msg_id ?? null,
      status: d.status,
      ts: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`callback ${res.status}`);
}

async function main(): Promise<void> {
  createWorker(QUEUES.dlr, handleJob, 30);
  // HTTP callbacks only — SMPP receipts live on QUEUES.clientDlr (smpp-server).
  createWorker(QUEUES.clientDlrHttp, processClientDlr, 20);
  console.log('[8xtelSMPP dlr-worker] started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
