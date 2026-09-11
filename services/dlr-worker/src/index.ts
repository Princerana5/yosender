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
}

const FINAL = new Set(['delivered', 'undelivered', 'expired', 'rejected', 'failed']);

async function process(job: { data: IncomingDlr }): Promise<void> {
  const { vendor_id, body } = job.data;
  const pool = getPool();
  const { vendor_msg_id, stat } = parseDlrBody(body);
  const vendorStatus = mapDlrStatus(stat);

  const msg = vendor_msg_id
    ? await queryOne<{
      id: string; client_id: string; status: string; source: string;
      destination: string; dlr_mode: string; dlr_callback_url: string | null;
    }>(
      `SELECT m.id, m.client_id, m.status, m.source, m.destination, c.dlr_mode, c.dlr_callback_url
       FROM messages m JOIN clients c ON c.id=m.client_id
       WHERE m.vendor_msg_id=$1 AND m.vendor_id=$2 ORDER BY m.created_at DESC LIMIT 1`,
      [vendor_msg_id, vendor_id],
    )
    : null;

  if (!msg) {
    console.warn(`[dlr] orphan DLR from vendor ${vendor_id}: ${body.slice(0, 120)}`);
    await incrStat('dlr_orphan');
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

  // Traffic policy: client-visible status may be sampled; raw NEVER rewritten (§19)
  const policy = await queryOne<{ report_policy: string }>(
    `SELECT tp.report_policy FROM traffic_policies tp
     JOIN messages m ON m.route_id=tp.route_id
     WHERE m.id=$1 AND tp.enabled=true ORDER BY tp.percentage DESC LIMIT 1`,
    [msg.id],
  );
  const clientStatus = policy?.report_policy === 'sampled' && vendorStatus === 'delivered' && Math.random() < 0.02
    ? 'undelivered' // sampled reporting policy — auditable, raw stays DELIVRD
    : vendorStatus;

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
  await pool.query(
    'INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,$3,$4)',
    [msg.id, vendor_id, 'dlr', `vendor=${vendorStatus} client=${clientStatus}`],
  );
  await pool.query(
    'UPDATE vendor_connections SET dlr_count = dlr_count + 1 WHERE vendor_id=$1',
    [vendor_id],
  );
  await incrStat(`dlr_${clientStatus}`);

  // Fan out to client (§17)
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
    await getQueue(QUEUES.clientDlr).add('http-callback', {
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
  createWorker(QUEUES.dlr, process, 30);
  createWorker(QUEUES.clientDlr, processClientDlr, 20);
  console.log('[8xtelSMPP dlr-worker] started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
