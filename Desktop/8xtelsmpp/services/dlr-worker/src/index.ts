import {
  createWorker, getQueue, QUEUES, getPool, queryOne,
  mapDlrStatus, parseDlrBody, incrStat,
} from '@8xtel/core';
import { randomUUID } from 'node:crypto';

// -- DLR worker: sms:dlr -> map -> store (immutable raw) -> client delivery
// Cutting / Delay: selected messages have their LEGITIMATE vendor DLR delayed
// by the configured seconds via dlr_delay_queue + sms-dlr-delay BullMQ queue.
// Never fabricates, never rewrites vendor status.

interface IncomingDlr {
  vendor_id: string;
  body: string;
  source: string;
  received_at: string;
  internal_id?: string;
  destination?: string;
}

const FINAL = new Set(['delivered', 'undelivered', 'expired', 'rejected', 'failed']);

async function handleJob(job: { data: IncomingDlr }): Promise<void> {
  const { vendor_id, body } = job.data;
  const pool = getPool();
  const { vendor_msg_id, stat } = parseDlrBody(body);
  const vendorStatus = mapDlrStatus(stat);

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

  if (vendorStatus === 'unknown') {
    await pool.query(
      `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'dlr',$3)`,
      [msg.id, vendor_id, `unrecognized stat ignored: ${body.slice(0, 120)}`],
    ).catch(() => undefined);
    await incrStat('dlr_unknown');
    return;
  }

  if (FINAL.has(msg.status)) {
    if (msg.status !== 'delivered' && vendorStatus === 'delivered') {
      // allow delivered upgrade
    } else {
      await pool.query(
        `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'dlr',$3)
         ON CONFLICT DO NOTHING`,
        [msg.id, vendor_id, `duplicate ${vendorStatus} ignored (final=${msg.status})`],
      ).catch(() => undefined);
      return;
    }
  }

  const clientStatus = vendorStatus;

  // -- For cut-selected messages: park the status update until release so
  // the client does not see delivered early. Write the raw DLR row but
  // leave messages.status untouched until the delay expires.
  const cutRowProbe = await queryOne<{
    dlr_cutting_selected: boolean; dlr_cutting_config_id: string | null; dlr_cutting_delay_seconds: number | null;
    route_id: string | null; country_id: string | null; client_id: string;
  }>(
    'SELECT dlr_cutting_selected, dlr_cutting_config_id, dlr_cutting_delay_seconds, route_id, country_id, client_id FROM messages WHERE id=$1',
    [msg.id],
  ).catch(() => null);
  const shouldDelay = !!cutRowProbe?.dlr_cutting_selected && Number(cutRowProbe?.dlr_cutting_delay_seconds ?? 0) > 0 && !!cutRowProbe?.dlr_cutting_config_id;

  await pool.query(
    `INSERT INTO dlrs (message_id, vendor_msg_id, raw_body, vendor_status, client_status, delivered_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $4='delivered' THEN now() ELSE NULL END)
     ON CONFLICT (message_id) DO UPDATE SET
       raw_body=EXCLUDED.raw_body, vendor_status=EXCLUDED.vendor_status,
       client_status=EXCLUDED.client_status,
       delivered_at=COALESCE(EXCLUDED.delivered_at, dlrs.delivered_at)`,
    [msg.id, vendor_msg_id, body, vendorStatus, clientStatus],
  );
  if (!shouldDelay) {
    await pool.query(
      'UPDATE messages SET status=$1, dlr_time=now(), error_code=$2 WHERE id=$3',
      [clientStatus, vendorStatus === 'delivered' ? null : 'vendor:' + vendorStatus, msg.id],
    );
  }

  // -- DLR Cutting: if selected, queue for delayed forwarding and PARK settlement/fanout
  try {
    if (shouldDelay && cutRowProbe) {
      const cutRow = cutRowProbe;
      const delaySec = Number(cutRow.dlr_cutting_delay_seconds ?? 0);
      const qid = randomUUID();
      const releaseAt = new Date(Date.now() + delaySec * 1000).toISOString();
      await pool.query(
        `INSERT INTO dlr_delay_queue (id, message_id, dlr_id, client_id, route_id, vendor_id, blending_vendor_id, country_id, original_status, selected, configured_percentage, configured_interval, delay_seconds, received_at, release_at, queue_status)
         VALUES ($1,$2,(SELECT id FROM dlrs WHERE message_id=$2),$3,$4,$5,(SELECT blending_vendor_id FROM messages WHERE id=$2),$6,$7,true,
           (SELECT percentage FROM dlr_cutting_configs WHERE id=$8),
           (SELECT interval_messages FROM dlr_cutting_configs WHERE id=$8),
           $9, now(), $10, 'queued')
         ON CONFLICT (message_id) DO NOTHING`,
        [qid, msg.id, cutRow.client_id, cutRow.route_id, vendor_id, cutRow.country_id, clientStatus, cutRow.dlr_cutting_config_id, delaySec, releaseAt],
      );
      const inserted = await queryOne<{ id: string }>('SELECT id FROM dlr_delay_queue WHERE message_id=$1 AND queue_status=$2', [msg.id, 'queued']);
      if (inserted) {
        await getQueue(QUEUES.dlrDelay).add('release', { queue_id: inserted.id, message_id: msg.id }, { delay: delaySec * 1000, jobId: `dlr-delay-${msg.id}` });
        await pool.query(
          `INSERT INTO dlr_cutting_stats (config_id, dlrs_received, dlrs_delayed, currently_queued) VALUES ($1,1,1,1)
           ON CONFLICT (config_id) DO UPDATE SET dlrs_received=dlr_cutting_stats.dlrs_received+1, dlrs_delayed=dlr_cutting_stats.dlrs_delayed+1, currently_queued=dlr_cutting_stats.currently_queued+1, updated_at=now()`,
          [cutRow.dlr_cutting_config_id],
        ).catch(() => undefined);
        await pool.query(
          `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'dlr-delay-queued',$3)`,
          [msg.id, vendor_id, `delay ${delaySec}s status=${clientStatus}`],
        ).catch(() => undefined);
        await incrStat('dlr_delay_queued');
        return; // park: status + settlement + fanout happen on release
      }
      // If insert was a no-op (duplicate), fall through to immediate and fix status
      await pool.query(
        'UPDATE messages SET status=$1, dlr_time=now(), error_code=$2 WHERE id=$3',
        [clientStatus, vendorStatus === 'delivered' ? null : 'vendor:' + vendorStatus, msg.id],
      );
    }
  } catch (e) {
    console.warn('[dlr-cutting] queue failed, falling through to immediate:', (e as Error).message);
    // Ensure status is still advanced if we skipped it above
    if (shouldDelay) {
      await pool.query(
        'UPDATE messages SET status=$1, dlr_time=now(), error_code=$2 WHERE id=$3',
        [clientStatus, vendorStatus === 'delivered' ? null : 'vendor:' + vendorStatus, msg.id],
      ).catch(() => undefined);
    }
  }

  // -- Immediate path: settlement + fanout
  await doSettlementAndFanout(msg, vendor_id, body, vendor_msg_id, clientStatus);
}

async function doSettlementAndFanout(
  msg: { id: string; client_id: string; source: string; destination: string; dlr_mode: string; dlr_callback_url: string | null },
  vendor_id: string,
  body: string,
  vendor_msg_id: string | null,
  clientStatus: string,
): Promise<void> {
  const pool = getPool();
  if (clientStatus !== 'delivered') {
    const creditHold = await queryOne<{ reserved_credits: string; client_id: string }>(
      'SELECT reserved_credits, client_id FROM messages WHERE id=$1', [msg.id],
    );
    const credits = Number(creditHold?.reserved_credits ?? 0);
    if (credits > 0) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const w = await db.query('SELECT sms_credits FROM wallets WHERE client_id=$1 FOR UPDATE', [creditHold!.client_id]);
        const after = +(Number(w.rows[0].sms_credits ?? 0) + credits).toFixed(2);
        await db.query('UPDATE wallets SET sms_credits=$1, updated_at=now() WHERE client_id=$2', [after, creditHold!.client_id]);
        await db.query('UPDATE clients SET sms_credits=$1 WHERE id=$2', [after, creditHold!.client_id]);
        await db.query(
          `INSERT INTO credit_transactions (client_id, message_id, type, amount, balance_after, description, remark)
           VALUES ($1,$2,'refund',$3,$4,$5,$6)`,
          [creditHold!.client_id, msg.id, credits, after, `Release credit hold ${msg.id.slice(0, 8)} (${clientStatus})`, `Credits released — outcome ${clientStatus}`],
        );
        await db.query('UPDATE messages SET reserved_credits=0 WHERE id=$1', [msg.id]);
        await db.query('COMMIT');
      } catch (e) { await db.query('ROLLBACK').catch(() => undefined); throw e; } finally { db.release(); }
    }
    const hold = await queryOne<{ reserved_amount: string; client_id: string }>(
      'SELECT reserved_amount, client_id FROM messages WHERE id=$1', [msg.id],
    );
    const amount = Number(hold?.reserved_amount ?? 0);
    if (amount > 0) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const w = await db.query('SELECT balance, currency FROM wallets WHERE client_id=$1 FOR UPDATE', [hold!.client_id]);
        const after = Number(w.rows[0].balance) + amount;
        await db.query('UPDATE wallets SET balance=$1, updated_at=now() WHERE client_id=$2', [after, hold!.client_id]);
        await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [after, hold!.client_id]);
        await db.query(
          `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description, remark, currency)
           VALUES ($1,$2,'refund',$3,$4,$5,$6,$7)`,
          [hold!.client_id, msg.id, amount, after, `Release hold ${msg.id.slice(0, 8)} (${clientStatus})`, `Hold released — outcome ${clientStatus}`, w.rows[0].currency],
        );
        await db.query('UPDATE messages SET reserved_amount=0 WHERE id=$1', [msg.id]);
        await db.query('COMMIT');
      } catch (e) { await db.query('ROLLBACK').catch(() => undefined); throw e; } finally { db.release(); }
    }
  }
  if (clientStatus === 'delivered') {
    const bill = await queryOne<{
      billing_mode: string; client_id: string; vendor_id: string;
      client_price: string | null; delivery_rate: string | null;
    }>(
      `SELECT m.billing_mode, m.client_id, m.vendor_id, m.client_price,
              (SELECT csr.delivery_rate FROM client_saved_rates csr WHERE csr.client_id=m.client_id LIMIT 1) AS delivery_rate
       FROM messages m WHERE m.id=$1`, [msg.id],
    );
    if (bill) {
      const { billsOnDelivery } = await import('@8xtel/core');
      if (billsOnDelivery(bill.billing_mode as never)) {
        await getQueue(QUEUES.billing).add('charge', {
          internal_id: msg.id, client_id: bill.client_id, vendor_id: bill.vendor_id ?? vendor_id,
          client_price: bill.client_price, billing_mode: bill.billing_mode,
          delivery_rate: bill.delivery_rate !== null ? Number(bill.delivery_rate) : null, component: 'delivery',
        });
      }
    }
  } else {
    await pool.query(
      `UPDATE messages SET billing_status='not_billed' WHERE id=$1 AND billing_mode IN ('on_delivery','operator_delivery') AND billing_status='awaiting_delivery'`, [msg.id],
    ).catch(() => undefined);
  }
  await pool.query(
    'INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,$3,$4)',
    [msg.id, vendor_id, 'dlr', `vendor=${clientStatus} client=${clientStatus}`],
  );
  await pool.query('UPDATE vendor_connections SET dlr_count = dlr_count + 1 WHERE vendor_id=$1', [vendor_id]);
  await incrStat(`dlr_${clientStatus}`);

  if (msg.dlr_mode === 'none') {
    console.warn(`[dlr] dlr_mode=none — fanout skipped for ${msg.id} client=${msg.client_id} status=${clientStatus} (panel/API polling still shows realtime)`);
    return;
  }
  if (msg.dlr_mode === 'smpp') {
    await getQueue(QUEUES.clientDlr).add('client-dlr', {
      internal_id: msg.id, client_id: msg.client_id, vendor_msg_id, status: clientStatus,
      error_code: null, error_description: null, raw_body: body, delivered_at: new Date().toISOString(),
      source: msg.source, destination: msg.destination,
    });
  } else if (msg.dlr_mode === 'http' || msg.dlr_mode === 'api') {
    if (!msg.dlr_callback_url) {
      console.warn(`[dlr] dlr_mode=${msg.dlr_mode} but dlr_callback_url is empty for ${msg.id} client=${msg.client_id} — DLR fanout DROPPED (dashboard is delivered, client sees SENT). Fix: set dlr_callback_url or set dlr_mode='smpp'`);
      await pool.query(
        `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'dlr-fanout-skipped',$3)`,
        [msg.id, vendor_id, `dlr_mode=${msg.dlr_mode} but no callback_url — fanout dropped`],
      ).catch(() => undefined);
      return;
    }
    await getQueue(QUEUES.clientDlrHttp).add('http-callback', {
      url: msg.dlr_callback_url, internal_id: msg.id, status: clientStatus, vendor_msg_id,
    });
  } else {
    // Unknown/null/empty — never silently drop. Fall back to SMPP so client still gets realtime deliver_sm.
    console.warn(`[dlr] unknown dlr_mode='${msg.dlr_mode}' for ${msg.id} — falling back to SMPP fanout (was silently dropped before)`);
    await getQueue(QUEUES.clientDlr).add('client-dlr', {
      internal_id: msg.id, client_id: msg.client_id, vendor_msg_id, status: clientStatus,
      error_code: null, error_description: null, raw_body: body, delivered_at: new Date().toISOString(),
      source: msg.source, destination: msg.destination,
    });
  }
}

async function releaseDelayed(job: { data: { queue_id: string; message_id: string } }): Promise<void> {
  const { queue_id, message_id } = job.data;
  const pool = getPool();
  const row = await queryOne<{
    id: string; message_id: string; client_id: string; route_id: string | null; vendor_id: string | null;
    original_status: string; delay_seconds: number; received_at: string; release_at: string; queue_status: string;
    config_id: string | null;
  }>(
    `SELECT q.id, q.message_id, q.client_id, q.route_id, q.vendor_id, q.original_status, q.delay_seconds, q.received_at, q.release_at, q.queue_status,
            m.dlr_cutting_config_id AS config_id
     FROM dlr_delay_queue q JOIN messages m ON m.id=q.message_id WHERE q.id=$1`, [queue_id],
  );
  if (!row || row.queue_status !== 'queued') return;
  const waitMs = new Date(row.release_at).getTime() - Date.now();
  if (waitMs > 1000) {
    await getQueue(QUEUES.dlrDelay).add('release', { queue_id, message_id }, { delay: waitMs, jobId: `dlr-delay-${message_id}-retry` });
    return;
  }
  const upd = await pool.query(`UPDATE dlr_delay_queue SET queue_status='released', released_at=now(), updated_at=now() WHERE id=$1 AND queue_status='queued' RETURNING id`, [queue_id]);
  if (!upd.rowCount) return;
  // Now apply the deferred message status (client sees delivered only after delay)
  await pool.query(
    'UPDATE messages SET status=$1, dlr_time=now(), error_code=$2 WHERE id=$3',
    [row.original_status, row.original_status === 'delivered' ? null : 'vendor:' + row.original_status, message_id],
  ).catch(() => undefined);
  if (row.config_id) {
    await pool.query(
      `UPDATE dlr_cutting_stats SET dlrs_released=dlr_cutting_stats.dlrs_released+1, currently_queued=GREATEST(0, dlr_cutting_stats.currently_queued-1), avg_delay_ms=$2, updated_at=now() WHERE config_id=$1`,
      [row.config_id, row.delay_seconds * 1000],
    ).catch(() => undefined);
  }
  await pool.query(`INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'dlr-delay-released',$3)`, [message_id, row.vendor_id, `released after ${row.delay_seconds}s status=${row.original_status}`]).catch(() => undefined);
  const dlr = await queryOne<{ vendor_msg_id: string | null; raw_body: string }>('SELECT vendor_msg_id, raw_body FROM dlrs WHERE message_id=$1', [message_id]);
  const msgRow = await queryOne<{ client_id: string; source: string; destination: string; dlr_mode: string; dlr_callback_url: string | null }>(
    'SELECT m.client_id, m.source, m.destination, c.dlr_mode, c.dlr_callback_url FROM messages m JOIN clients c ON c.id=m.client_id WHERE m.id=$1', [message_id],
  );
  if (!msgRow) return;
  // Settlement now (was parked)
  await doSettlementAndFanout(
    { id: message_id, client_id: msgRow.client_id, source: msgRow.source, destination: msgRow.destination, dlr_mode: msgRow.dlr_mode, dlr_callback_url: msgRow.dlr_callback_url },
    row.vendor_id ?? '', dlr?.raw_body ?? '', dlr?.vendor_msg_id ?? null, row.original_status,
  );
  await incrStat('dlr_delay_released');
}

async function processClientDlr(job: { data: Record<string, unknown> }): Promise<void> {
  const d = job.data as { url?: string; internal_id: string; status: string; vendor_msg_id?: string };
  if (!d.url) return;
  const res = await fetch(d.url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message_id: d.internal_id, vendor_msg_id: d.vendor_msg_id ?? null, status: d.status, ts: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`callback ${res.status}`);
}

async function main(): Promise<void> {
  createWorker(QUEUES.dlr, handleJob, 30);
  createWorker(QUEUES.dlrDelay, releaseDelayed, 20);
  createWorker(QUEUES.clientDlrHttp, processClientDlr, 20);
  try {
    const pool = getPool();
    const overdue = await pool.query("SELECT id, message_id, release_at FROM dlr_delay_queue WHERE queue_status='queued'");
    for (const r of overdue.rows as Array<{ id: string; message_id: string; release_at: string }>) {
      const delay = Math.max(0, new Date(r.release_at).getTime() - Date.now());
      await getQueue(QUEUES.dlrDelay).add('release', { queue_id: r.id, message_id: r.message_id }, { delay, jobId: `drain-${r.id}` });
    }
    if (overdue.rows.length) console.log(`[dlr] drained ${overdue.rows.length} queued delayed DLRs`);
  } catch (e) { console.warn('[dlr] drain failed', (e as Error).message); }
  console.log('[8xtelSMPP dlr-worker] started');
}

main().catch((e) => { console.error(e); process.exit(1); });
