import {
  createWorker, getQueue, QUEUES, getPool, queryOne,
  tryAcquireTps, incrStat, type MessageJob,
} from '@8xtel/core';
import { loadConnectors, listenControl, syncConnectors, type ConnectorRegistry, VendorConnector } from './connector.js';
import { HttpVendorSender } from './http-sender.js';
import { startDlrPoller } from './dlr-poller.js';

// ── Vendor worker: sms:vendor-send → upstream submit_sm (§15, §37) ───────────
// Walks the vendor_chain; on failure records the hop and tries the next vendor
// (failover). Exhausted chain → message failed + billing reversal signal.

interface SendJob extends MessageJob {
  vendor_chain: string[];
  vendor_index: number;
  client_price: string | null;
}

const byVendor: ConnectorRegistry = new Map<string, VendorConnector[]>();

function pick(vendorId: string): VendorConnector | undefined {
  const list = (byVendor.get(vendorId) ?? []).filter((c) => c.connected);
  if (!list.length) return undefined;
  // least-loaded pick could go here; round-robin across binds:
  return list[Math.floor(Math.random() * list.length)];
}

async function handleJob(job: { data: SendJob }): Promise<void> {
  const msg = job.data;
  const pool = getPool();
  const vendorId = msg.vendor_chain[msg.vendor_index];

  if (!vendorId) {
    await pool.query(
      `UPDATE messages SET status='failed', error_description='all vendors exhausted' WHERE id=$1`,
      [msg.internal_id],
    );
    await pool.query(
      `INSERT INTO message_events (message_id, event, detail) VALUES ($1,'failed','vendor chain exhausted')`,
      [msg.internal_id],
    );
    await incrStat('failed');
    // Release the submit-time hold (no vendor accepted → no charge)
    const hold = await queryOne<{ reserved_amount: string }>(
      'SELECT reserved_amount FROM messages WHERE id=$1', [msg.internal_id],
    );
    const amount = Number(hold?.reserved_amount ?? 0);
    if (amount > 0) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const w = await db.query('SELECT balance, currency FROM wallets WHERE client_id=$1 FOR UPDATE', [msg.client_id]);
        const after = Number(w.rows[0].balance) + amount;
        await db.query('UPDATE wallets SET balance=$1, updated_at=now() WHERE client_id=$2', [after, msg.client_id]);
        await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [after, msg.client_id]);
        await db.query(
          `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description, remark, currency)
           VALUES ($1,$2,'refund',$3,$4,$5,$6,$7)`,
          [msg.client_id, msg.internal_id, amount, after,
           `Release hold ${msg.internal_id.slice(0, 8)} (all vendors failed)`,
           'Hold released — no vendor accepted', w.rows[0].currency],
        );
        await db.query('UPDATE messages SET reserved_amount=0 WHERE id=$1', [msg.internal_id]);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        db.release();
      }
    }
    return;
  }

  // Vendor TPS guard — delay, don't drop (§18).
  // Non-filling acquire: denied jobs leave no window entry, so a 1000-TPS
  // burst retrying against a small vendor cap can't saturate its own window
  // into a self-inflicted stall (same deadlock class as the client guard).
  // Runs BEFORE the transport branch so SMPP and HTTP vendors share pacing.
  const vRow = await queryOne<{
    tps: number; protocol: string; name: string;
    source_ton: number; source_npi: number; dest_ton: number; dest_npi: number;
    synthetic_dlr_enabled: boolean;
  }>(
    `SELECT tps, COALESCE(protocol,'smpp') AS protocol, name, synthetic_dlr_enabled,
            source_ton, source_npi, dest_ton, dest_npi FROM vendors WHERE id=$1`, [vendorId],
  );
  if (vRow && !(await tryAcquireTps(`vendor:${vendorId}`, vRow.tps))) {
    await getQueue(QUEUES.vendorSend).add('send', msg, { delay: 500 });
    return;
  }

  // ── HTTP vendors: no SMPP bind — one HTTPS request per message ──────────
  // SMPP vendors skip this block entirely (protocol='smpp' → conn path below,
  // byte-identical to before). HTTP failures fall through to the same
  // failover catch as SMPP submit errors.
  let vendorMsgId: string;
  let httpSender: HttpVendorSender | null = null;
  if ((vRow?.protocol ?? 'smpp') === 'http') {
    httpSender = new HttpVendorSender(vendorId, vRow?.name ?? vendorId);
    try {
      vendorMsgId = await httpSender.submit({
        source: msg.source,
        destination: msg.destination,
        text: msg.text,
        internal_id: msg.internal_id,
        dlr_token: null, // operator pastes full webhook URL into template if needed
      });
    } catch (e) {
      const em = (e as Error).message;
      await pool.query(
        `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'failover',$3)`,
        [msg.internal_id, vendorId, `http submit error: ${em}`],
      );
      await pool.query(`INSERT INTO failover_logs (message_id, route_id, from_vendor_id, reason, attempt) VALUES ($1,$2,$3,$4,1)`,
        [msg.internal_id, msg.route_id ?? null, vendorId, em.slice(0, 500)]).catch(() => undefined);
      try {
        const rule = await pool.query(`SELECT retry_delay_ms, max_attempts FROM failover_rules WHERE route_id=$1 AND vendor_id=$2 AND enabled=true`, [msg.route_id, vendorId]).then((r) => r.rows[0] as { retry_delay_ms: number; max_attempts: number } | undefined).catch(() => undefined);
        const delay = rule?.retry_delay_ms ?? 500;
        if (rule && (msg.attempts ?? 0) + 1 > rule.max_attempts) {
          await pool.query(`UPDATE messages SET status='failed', error_description=$1 WHERE id=$2`, [`http failover max attempts exhausted: ${em}`, msg.internal_id]);
          return;
        }
        await getQueue(QUEUES.vendorSend).add('send', { ...msg, vendor_index: msg.vendor_index + 1, attempts: msg.attempts + 1 }, { delay });
      } catch { await getQueue(QUEUES.vendorSend).add('send', { ...msg, vendor_index: msg.vendor_index + 1, attempts: msg.attempts + 1 }); }
      return;
    }
  } else {
    const conn = pick(vendorId);
    if (!conn) {
      // Vendor temporarily down → wait + retry SAME vendor, don't burn the chain.
      // Only fail over on real submit errors (handled below). Attempts cap the
      // wait so a dead vendor eventually fails over instead of looping forever.
      const attempts = msg.attempts ?? 0;
      if (attempts < 3) {
        await getQueue(QUEUES.vendorSend).add('send', { ...msg, attempts: attempts + 1 }, { delay: 500 });
        return;
      }
      await pool.query(
        `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'failover','vendor not connected after retries')`,
        [msg.internal_id, vendorId],
      );
      await getQueue(QUEUES.vendorSend).add('send', { ...msg, vendor_index: msg.vendor_index + 1 });
      return;
    }
    try {
      vendorMsgId = await conn.submit({
        source: msg.source,
        destination: msg.destination,
        text: msg.text,
        data_coding: msg.data_coding,
        source_ton: vRow?.source_ton ?? 0,
        source_npi: vRow?.source_npi ?? 1,
        dest_ton: vRow?.dest_ton ?? 0,
        dest_npi: vRow?.dest_npi ?? 1,
        registered_delivery: 1,
      });
    } catch (e) {
      const em = (e as Error).message;
      await pool.query(
        `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'failover',$3)`,
        [msg.internal_id, vendorId, `submit error: ${em}`],
      );
      // failover log + rule-aware retry delay
      try {
        const rule = await pool.query(`SELECT failover_vendor_id, retry_delay_ms, max_attempts, condition FROM failover_rules WHERE route_id=$1 AND vendor_id=$2 AND enabled=true`, [msg.route_id, vendorId]).then((r) => r.rows[0] as { failover_vendor_id: string | null; retry_delay_ms: number; max_attempts: number; condition: string } | undefined).catch(() => undefined);
        const delay = rule?.retry_delay_ms ?? 500;
        // respect max_attempts
        const nextIdx = rule?.failover_vendor_id
          ? (msg.vendor_chain.indexOf(rule.failover_vendor_id) >= 0 ? msg.vendor_chain.indexOf(rule.failover_vendor_id) : msg.vendor_index + 1)
          : msg.vendor_index + 1;
        const attempts = (msg.attempts ?? 0) + 1;
        if (rule && attempts > rule.max_attempts) {
          await pool.query(`UPDATE messages SET status='failed', error_description=$1 WHERE id=$2`, [`failover max attempts (${rule.max_attempts}) exhausted: ${em}`, msg.internal_id]);
          return;
        }
        await pool.query(`INSERT INTO failover_logs (message_id, route_id, from_vendor_id, to_vendor_id, reason, attempt) VALUES ($1,$2,$3,$4,$5,$6)`,
          [msg.internal_id, msg.route_id ?? null, vendorId, msg.vendor_chain[nextIdx] ?? null, em.slice(0, 500), attempts]).catch(() => undefined);
        await getQueue(QUEUES.vendorSend).add('send', { ...msg, vendor_index: nextIdx, attempts }, { delay });
      } catch {
        await getQueue(QUEUES.vendorSend).add('send', { ...msg, vendor_index: msg.vendor_index + 1, attempts: msg.attempts + 1 });
      }
      return;
    }
  }

  // ── Post-submit bookkeeping (shared by both transports) ─────────────────
  // The vendor has ACCEPTED the message at this point — a DB error here must
  // NOT fail over (that would double-send). Throw so BullMQ retries the
  // bookkeeping; all writes are idempotent on message id.
  // blending_vendor_id = actual vendor when it differs from the chain head
  // (failover hop or percentage split) so DLR logs show the Blending vendor.
  const headVendorId: string | null = (msg.vendor_chain as string[])[0] ?? null;
  const blendingId: string | null = headVendorId && vendorId !== headVendorId ? vendorId : null;
  await pool.query(
    `UPDATE messages SET vendor_id=$1, vendor_msg_id=$2, attempts=attempts+1, blending_vendor_id=COALESCE($4, blending_vendor_id) WHERE id=$3`,
    [vendorId, vendorMsgId, msg.internal_id, blendingId],
  );
  await pool.query(
    `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'sent',$3)`,
    [msg.internal_id, vendorId, `vendor_msg_id=${vendorMsgId}`],
  );
  if (httpSender) await httpSender.markSent();
  else {
    await pool.query(
      'UPDATE vendor_connections SET messages_sent = messages_sent + 1 WHERE vendor_id=$1',
      [vendorId],
    );
  }
  await incrStat('sent');
  // ── Synthetic delivered DLR (per-vendor toggle in Vendors → Synthetic delivery) ─
  // When vendors.synthetic_dlr_enabled = true, schedule a local DELIVRD 3-5s after
  // submit for vendors that never push a real DLR (e.g. MANISH). OFF = no fake DLR,
  // only real DLRs count. Overridden to always-on when AUTO_DLR_ALL=1 for debugging.
  try {
    const autoDlr = !!vRow?.synthetic_dlr_enabled || process.env.AUTO_DLR_ALL === '1';
    if (autoDlr && vendorMsgId) {
      const delayMs = 3000 + Math.floor(Math.random() * 2000); // 3–5 s jitter
      const nowStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      const body = `id:${vendorMsgId} sub:001 dlvrd:001 submit date:${nowStr} done date:${nowStr} stat:DELIVRD err:000 Text:${msg.text.slice(0, 20)}`;
      await getQueue(QUEUES.dlr).add('dlr', {
        vendor_id: vendorId,
        body,
        source: msg.source,
        received_at: new Date().toISOString(),
        internal_id: msg.internal_id,
        destination: msg.destination,
      } as never, { delay: delayMs });
      await pool.query(
        `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'auto-dlr-scheduled',$3)`,
        [msg.internal_id, vendorId, `synthetic DELIVRD in ${delayMs}ms`],
      ).catch(() => undefined);
    }
  } catch (e) {
    console.warn('[vendor] auto-dlr schedule failed', (e as Error).message);
  }
  // Charge client + record vendor cost (async, idempotent on message id)
  await getQueue(QUEUES.billing).add('charge', {
    internal_id: msg.internal_id,
    client_id: msg.client_id,
    vendor_id: vendorId,
    client_price: msg.client_price,
  });
}

async function main(): Promise<void> {
  const initial = await loadConnectors();
  let n = 0;
  for (const c of initial) {
    const list = byVendor.get(c.vendorId) ?? [];
    list.push(c);
    byVendor.set(c.vendorId, list);
    await c.start();
    n++;
  }
  await listenControl(byVendor);
  // Safety net: periodic reconcile in case a sync signal is ever missed
  // (e.g. worker was down when the vendor was created). Cheap + idempotent —
  // untouched binds are left alone.
  setInterval(() => {
    syncConnectors(byVendor).catch((e) => console.error('[vendor] periodic sync failed', (e as Error).message));
  }, 60_000).unref();
  createWorker(QUEUES.vendorSend, handleJob, Number(process.env.VENDOR_WORKER_CONCURRENCY ?? 100));
  startDlrPoller(); // pull-style DLR polling for HTTP vendors (no-op when none configured)
  console.log(`[8xtelSMPP vendor-worker] started with ${n} connector(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
