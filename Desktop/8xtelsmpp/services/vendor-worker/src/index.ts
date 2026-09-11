import {
  createWorker, getQueue, QUEUES, getPool, queryOne,
  checkTps, incrStat, type MessageJob,
} from '@8xtel/core';
import { loadConnectors, listenControl, VendorConnector } from './connector.js';

// ── Vendor worker: sms:vendor-send → upstream submit_sm (§15, §37) ───────────
// Walks the vendor_chain; on failure records the hop and tries the next vendor
// (failover). Exhausted chain → message failed + billing reversal signal.

interface SendJob extends MessageJob {
  vendor_chain: string[];
  vendor_index: number;
  client_price: string | null;
}

let connectors: VendorConnector[] = [];
const byVendor = new Map<string, VendorConnector[]>();

function pick(vendorId: string): VendorConnector | undefined {
  const list = (byVendor.get(vendorId) ?? []).filter((c) => c.connected);
  if (!list.length) return undefined;
  // least-loaded pick could go here; round-robin across binds:
  return list[Math.floor(Math.random() * list.length)];
}

async function process(job: { data: SendJob }): Promise<void> {
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
    // Signal billing to refund the reservation
    await getQueue(QUEUES.billing).add('refund', { internal_id: msg.internal_id, client_id: msg.client_id });
    return;
  }

  const conn = pick(vendorId);
  if (!conn) {
    // Vendor down → immediate failover to next in chain (§11)
    await pool.query(
      `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'failover','vendor not connected')`,
      [msg.internal_id, vendorId],
    );
    await getQueue(QUEUES.vendorSend).add('send', { ...msg, vendor_index: msg.vendor_index + 1 });
    return;
  }

  // Vendor TPS guard — delay, don't drop (§18)
  const vRow = await queryOne<{ tps: number; source_ton: number; source_npi: number; dest_ton: number; dest_npi: number }>(
    'SELECT tps, source_ton, source_npi, dest_ton, dest_npi FROM vendors WHERE id=$1', [vendorId],
  );
  if (vRow && !(await checkTps(`vendor:${vendorId}`, vRow.tps))) {
    await getQueue(QUEUES.vendorSend).add('send', msg, { delay: 500 });
    return;
  }

  try {
    const vendorMsgId = await conn.submit({
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
    await pool.query(
      `UPDATE messages SET vendor_id=$1, vendor_msg_id=$2, attempts=attempts+1 WHERE id=$3`,
      [vendorId, vendorMsgId, msg.internal_id],
    );
    await pool.query(
      `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'sent',$3)`,
      [msg.internal_id, vendorId, `vendor_msg_id=${vendorMsgId}`],
    );
    await pool.query(
      'UPDATE vendor_connections SET messages_sent = messages_sent + 1 WHERE vendor_id=$1',
      [vendorId],
    );
    await incrStat('sent');
    // Charge client + record vendor cost (async, idempotent on message id)
    await getQueue(QUEUES.billing).add('charge', {
      internal_id: msg.internal_id,
      client_id: msg.client_id,
      vendor_id: vendorId,
      client_price: msg.client_price,
    });
  } catch (e) {
    await pool.query(
      `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'failover',$3)`,
      [msg.internal_id, vendorId, `submit error: ${(e as Error).message}`],
    );
    await getQueue(QUEUES.vendorSend).add('send', {
      ...msg,
      vendor_index: msg.vendor_index + 1,
      attempts: msg.attempts + 1,
    });
  }
}

async function main(): Promise<void> {
  connectors = await loadConnectors();
  for (const c of connectors) {
    const list = byVendor.get(c.vendorId) ?? [];
    list.push(c);
    byVendor.set(c.vendorId, list);
    await c.start();
  }
  await listenControl(connectors);
  createWorker(QUEUES.vendorSend, process, 30);
  console.log(`[8xtelSMPP vendor-worker] started with ${connectors.length} connector(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
