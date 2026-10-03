import {
  createWorker,
  getAnyRcsQueue,
  getPool,
  queryOne,
  RCS_QUEUES,
  tryAcquireTps,
  type RcsContent,
  type RcsNormalizedWebhook,
  type RcsProviderCredentials,
  type RcsStatus,
} from '@8xtel/core';
import { decryptRcsSecret, GenericHttpRcsAdapter, shouldAdvanceStatus } from '@8xtel/core';

interface MessageRow {
  id: string;
  client_id: string;
  campaign_id: string | null;
  route_id: string | null;
  vendor_id: string | null;
  provider_message_id: string | null;
  sender: string;
  destination: string;
  content: RcsContent;
  status: RcsStatus;
  price: string;
  attempts: number;
  billing_state: 'reserved' | 'charged' | 'released' | 'not_applicable';
  billing_cycle: number;
  country_id: string | null;
}
interface MessageJob { message_id: string; throttle_attempt?: number }
interface RouteVendor {
  vendor_id: string;
  priority: number;
  weight: number;
  vendor_tps: number;
  vendor_daily_limit: number | null;
  vendor_monthly_limit: number | null;
}
interface RouteGroup {
  route_id: string;
  strategy: string;
  tps_limit: number | null;
  daily_limit: number | null;
  monthly_limit: number | null;
  vendors: RouteVendor[];
}
interface SendJob extends MessageJob {
  vendor_chain: string[];
  vendor_index: number;
  route_id: string;
  attempt: number;
}
interface WebhookJob { event_id: string; normalized: RcsNormalizedWebhook }
interface BillingJob { message_id: string; outcome: 'submitted' | 'delivered' | 'failed' }

const pool = getPool();
const adapter = new GenericHttpRcsAdapter();
const MAX_SEND_ATTEMPTS = 5;
const CAMPAIGN_BATCH_SIZE = 250;
const TERMINAL_FAILURES = new Set<RcsStatus>(['undelivered', 'expired', 'rejected', 'failed']);

async function deadLetter(messageId: string, queueName: string, reason: string, attempts: number, payload: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO rcs_dead_letters(message_id,queue_name,reason,attempts,payload)
     VALUES($1,$2,$3,$4,$5)`,
    [messageId, queueName, reason.slice(0, 500), attempts, JSON.stringify(payload ?? {})],
  );
}

async function readMessage(messageId: string): Promise<MessageRow | null> {
  return queryOne<MessageRow>(
    `SELECT id,client_id,campaign_id,route_id,vendor_id,provider_message_id,sender,destination,
            content,status,price::text,attempts,billing_state,billing_cycle,country_id
     FROM rcs_messages WHERE id=$1`, [messageId],
  );
}

async function routeMessage(job: MessageJob): Promise<void> {
  const msg = await readMessage(job.message_id);
  if (!msg || msg.status !== 'queued') return;
  if (msg.campaign_id) {
    const campaign = await queryOne<{ status: string }>('SELECT status FROM rcs_campaigns WHERE id=$1', [msg.campaign_id]);
    if (!campaign || campaign.status === 'cancelled' || campaign.status === 'failed') {
      await failMessage(msg, 'CAMPAIGN_CANCELLED', 'Campaign is no longer active');
      return;
    }
  }
  const client = await queryOne<{ status: string; rcs_enabled: boolean; daily_limit: number | null; monthly_limit: number | null }>(
    'SELECT status,rcs_enabled,daily_limit,monthly_limit FROM clients WHERE id=$1', [msg.client_id],
  );
  if (!client || client.status !== 'active' || !client.rcs_enabled) {
    await failMessage(msg, 'CLIENT_DISABLED', 'RCS account is disabled');
    return;
  }

  const routes = await pool.query(
    `SELECT r.id AS route_id,r.strategy,r.tps_limit,r.daily_limit,r.monthly_limit,
            rv.vendor_id,rv.priority,rv.weight,v.tps_limit AS vendor_tps,
            v.daily_limit AS vendor_daily_limit,v.monthly_limit AS vendor_monthly_limit
       FROM rcs_routes r
       JOIN rcs_route_clients rc ON rc.route_id=r.id AND rc.client_id=$1
       JOIN rcs_route_vendors rv ON rv.route_id=r.id
       JOIN rcs_vendors v ON v.id=rv.vendor_id AND v.status='enabled'
      WHERE r.status='active'
        AND (r.country_id IS NULL OR r.country_id=$2)
        AND (r.sender IS NULL OR r.sender=$3)
      ORDER BY (r.country_id IS NOT NULL) DESC,(r.sender IS NOT NULL) DESC,r.created_at,r.id,rv.priority`,
    [msg.client_id, msg.country_id, msg.sender],
  );
  if (!routes.rowCount) {
    await failMessage(msg, 'NO_RCS_ROUTE', 'No active RCS route is allocated to this client');
    return;
  }

  const grouped = new Map<string, RouteGroup>();
  for (const row of routes.rows) {
    let route = grouped.get(row.route_id);
    if (!route) {
      route = { route_id: row.route_id, strategy: row.strategy, tps_limit: row.tps_limit, daily_limit: row.daily_limit, monthly_limit: row.monthly_limit, vendors: [] };
      grouped.set(row.route_id, route);
    }
    route.vendors.push({ vendor_id: row.vendor_id, priority: row.priority, weight: row.weight, vendor_tps: row.vendor_tps, vendor_daily_limit: row.vendor_daily_limit, vendor_monthly_limit: row.vendor_monthly_limit });
  }

  let tpsThrottled = false;
  for (const route of grouped.values()) {
    if (route.tps_limit && !(await tryAcquireTps(`rcs-route:${route.route_id}`, route.tps_limit))) {
      tpsThrottled = true;
      continue;
    }
    if (!await acquirePeriodLimits([
      { scope: 'client', id: msg.client_id, daily: client.daily_limit, monthly: client.monthly_limit },
      { scope: 'route', id: route.route_id, daily: route.daily_limit, monthly: route.monthly_limit },
    ], msg.id, msg.billing_cycle)) continue;
    const candidates = selectVendorOrder(route.vendors, route.strategy, route.route_id, msg.id);
    if (!candidates.length) continue;
    const changed = await pool.query(
      `UPDATE rcs_messages SET route_id=$1,status='accepted',updated_at=now()
       WHERE id=$2 AND status='queued' RETURNING id`, [route.route_id, msg.id],
    );
    if (!changed.rowCount) return;
    await getAnyRcsQueue(RCS_QUEUES.vendorSend).add('send', {
      message_id: msg.id, route_id: route.route_id, vendor_chain: candidates.map((vendor) => vendor.vendor_id), vendor_index: 0, attempt: 0,
    } satisfies SendJob, { jobId: `${msg.id}:cycle:${msg.billing_cycle}:route:${route.route_id}` });
    return;
  }
  if (tpsThrottled) {
    await getAnyRcsQueue(RCS_QUEUES.route).add('route', { message_id: msg.id, throttle_attempt: (job.throttle_attempt ?? 0) + 1 }, {
      delay: Math.min(30_000, 500 + ((job.throttle_attempt ?? 0) * 500)),
      jobId: `${msg.id}:cycle:${msg.billing_cycle}:route:retry:${job.throttle_attempt ?? 0}`,
    });
    return;
  }
  await failMessage(msg, 'ROUTE_LIMIT', 'No RCS route is currently available within its limits');
}

function selectVendorOrder<T extends RouteVendor>(vendors: T[], strategy: string, routeId: string, messageId: string): T[] {
  const ordered = [...vendors].sort((a, b) => a.priority - b.priority || a.vendor_id.localeCompare(b.vendor_id));
  if (strategy !== 'percentage' || ordered.length < 2) return ordered;
  const positive = ordered.filter((item) => item.weight > 0);
  const total = positive.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return ordered;
  const bucket = stableBucket(`${routeId}:${messageId}`, total);
  let cursor = 0;
  const primary = positive.find((item) => {
    cursor += item.weight;
    return bucket < cursor;
  })!;
  return [primary, ...ordered.filter((item) => item.vendor_id !== primary.vendor_id)];
}

function stableBucket(value: string, mod: number): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % mod;
}

interface PeriodLimitRequest { scope: 'client' | 'route' | 'vendor'; id: string; daily: number | null; monthly: number | null }
async function acquirePeriodLimits(requests: PeriodLimitRequest[], messageId: string, billingCycle: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const month = `${day.slice(0, 7)}-01`;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const request of requests) {
      for (const [period, start, limit] of [['day', day, request.daily], ['month', month, request.monthly]] as const) {
        if (limit === null || limit === undefined) continue;
        const eventKey = `${messageId}:${billingCycle}:${request.scope}:${request.id}:${period}:${start}`;
        const claimed = await db.query(
          `INSERT INTO rcs_usage_limit_events(event_key,scope_type,scope_id,period_type,period_start)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(event_key) DO NOTHING
           RETURNING event_key`, [eventKey, request.scope, request.id, period, start],
        );
        if (!claimed.rowCount) continue;
        const result = await db.query(
          `INSERT INTO rcs_usage_counters(scope_type,scope_id,period_type,period_start,submissions)
           VALUES($1,$2,$3,$4,1)
           ON CONFLICT(scope_type,scope_id,period_type,period_start)
           DO UPDATE SET submissions=rcs_usage_counters.submissions+1,updated_at=now()
             WHERE rcs_usage_counters.submissions < $5
           RETURNING submissions`, [request.scope, request.id, period, start, limit],
        );
        if (!result.rowCount) { await db.query('ROLLBACK'); return false; }
      }
    }
    await db.query('COMMIT');
    return true;
  } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; } finally { db.release(); }
}

async function sendMessage(job: SendJob): Promise<void> {
  const msg = await readMessage(job.message_id);
  if (!msg || ['submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'].includes(msg.status)) return;
  if (msg.campaign_id) {
    const campaign = await queryOne<{ status: string }>('SELECT status FROM rcs_campaigns WHERE id=$1', [msg.campaign_id]);
    if (!campaign || campaign.status === 'cancelled' || campaign.status === 'failed') {
      await failMessage(msg, 'CAMPAIGN_CANCELLED', 'Campaign is no longer active');
      return;
    }
  }
  const vendorId = job.vendor_chain[job.vendor_index];
  if (!vendorId) {
    await failMessage(msg, 'VENDOR_CHAIN_EXHAUSTED', 'All RCS providers failed', job.attempt);
    return;
  }
  const vendor = await queryOne<{ endpoint: string; credentials_enc: string; timeout_ms: number; provider_key: string; tps_limit: number; daily_limit: number | null; monthly_limit: number | null; status: string }>(
    `SELECT endpoint,credentials_enc,timeout_ms,provider_key,tps_limit,daily_limit,monthly_limit,status FROM rcs_vendors WHERE id=$1`, [vendorId],
  );
  if (!vendor || vendor.status !== 'enabled') {
    await nextVendor(job, vendorId, 'provider disabled or unavailable');
    return;
  }
  if (!(await tryAcquireTps(`rcs-vendor:${vendorId}`, vendor.tps_limit))) {
    await enqueueSend(job, 1000 + Math.floor(Math.random() * 500), `tps-${cryptoRandomUUID()}`);
    return;
  }
  if (job.attempt >= MAX_SEND_ATTEMPTS) {
    await nextVendor(job, vendorId, 'provider retry limit exhausted');
    return;
  }
  if (job.attempt === 0 && !await acquirePeriodLimits([
    { scope: 'vendor', id: vendorId, daily: vendor.daily_limit, monthly: vendor.monthly_limit },
  ], msg.id, msg.billing_cycle)) {
    await nextVendor(job, vendorId, 'provider daily or monthly limit exhausted');
    return;
  }

  let result: { providerMessageId: string };
  try {
    if (vendor.provider_key !== adapter.key) throw Object.assign(new Error('provider adapter is not installed'), { kind: 'permanent', code: 'ADAPTER_UNAVAILABLE' });
    const credentials = JSON.parse(decryptRcsSecret(vendor.credentials_enc)) as RcsProviderCredentials;
    result = await adapter.send({ endpoint: vendor.endpoint, credentials, from: msg.sender, to: msg.destination, content: msg.content, timeoutMs: vendor.timeout_ms, idempotencyKey: `rcs:${msg.id}:${msg.billing_cycle}` });
  } catch (error) {
    const e = error as Error & { kind?: string; code?: string };
    const description = e.message.slice(0, 500);
    if (e.kind === 'retryable' || e.kind === 'rate_limited') {
      if (job.attempt + 1 < MAX_SEND_ATTEMPTS) {
        await pool.query(`UPDATE rcs_messages SET attempts=attempts+1,error_code=$1,error_description=$2,updated_at=now() WHERE id=$3`, [e.code ?? 'PROVIDER_RETRY', description, msg.id]);
        await enqueueSend({ ...job, attempt: job.attempt + 1 }, Math.min(60_000, 1000 * (2 ** job.attempt)) + Math.floor(Math.random() * 1000), `retry${job.attempt + 1}`);
        return;
      }
    }
    const permanent = e.kind === 'permanent' || e.kind === 'auth' || job.attempt + 1 >= MAX_SEND_ATTEMPTS;
    if (permanent) {
      await pool.query(`UPDATE rcs_messages SET attempts=attempts+1,error_code=$1,error_description=$2 WHERE id=$3`, [e.code ?? 'PROVIDER_ERROR', description, msg.id]);
      await nextVendor(job, vendorId, description);
      return;
    }
    throw error;
  }

  // Persist acceptance before the worker acknowledges the queue job. If this
  // write fails, retrying bookkeeping must not submit a second time.
  const updated = await pool.query(
    `UPDATE rcs_messages SET vendor_id=$1,provider_message_id=$2,status='submitted',
       attempts=attempts+1,error_code=NULL,error_description=NULL,updated_at=now()
     WHERE id=$3 AND status NOT IN ('delivered','undelivered','expired','rejected','failed')
     RETURNING id`, [vendorId, result.providerMessageId, msg.id],
  );
  if (!updated.rowCount) return;
  const mode = await billingMode(msg);
  if (mode === 'on_submission') await getAnyRcsQueue(RCS_QUEUES.billing).add('settle', { message_id: msg.id, outcome: 'submitted' } satisfies BillingJob, { jobId: `submission:${msg.id}` });
}

async function enqueueSend(job: SendJob, delay: number, suffix: string): Promise<void> {
  await getAnyRcsQueue(RCS_QUEUES.vendorSend).add('send', job, { delay, jobId: `${job.message_id}:${job.vendor_index}:${suffix}:${job.attempt}` });
}
async function nextVendor(job: SendJob, vendorId: string, reason: string): Promise<void> {
  const next = { ...job, vendor_index: job.vendor_index + 1, attempt: 0 };
  if (next.vendor_index >= next.vendor_chain.length) {
    const msg = await readMessage(job.message_id);
    if (msg) await failMessage(msg, 'PROVIDER_FAILED', reason, job.attempt + 1);
    return;
  }
  await pool.query(`UPDATE rcs_messages SET error_code='PROVIDER_FAILOVER',error_description=$1 WHERE id=$2 AND status NOT IN ('delivered','undelivered','expired','rejected','failed')`, [reason.slice(0, 500), job.message_id]);
  await enqueueSend(next, 0, `failover-${vendorId}`);
}

async function failMessage(msg: MessageRow, code: string, description: string, attempts = msg.attempts): Promise<void> {
  const updated = await pool.query(
    `UPDATE rcs_messages SET status='failed',error_code=$1,error_description=$2,attempts=GREATEST(attempts,$3),updated_at=now()
     WHERE id=$4 AND status NOT IN ('delivered','undelivered','expired','rejected','failed') RETURNING id`,
    [code, description.slice(0, 500), attempts, msg.id],
  );
  if (!updated.rowCount) return;
  await deadLetter(msg.id, RCS_QUEUES.vendorSend, description, attempts, { code });
  await getAnyRcsQueue(RCS_QUEUES.billing).add('settle', { message_id: msg.id, outcome: 'failed' } satisfies BillingJob, { jobId: `failure:${msg.id}` });
  if (msg.campaign_id) await refreshCampaign(msg.campaign_id);
}

async function processWebhook(job: WebhookJob): Promise<void> {
  const event = await queryOne<{ id: string; vendor_id: string; processing_status: string }>(
    'SELECT id,vendor_id,processing_status FROM rcs_webhook_events WHERE id=$1', [job.event_id],
  );
  if (!event || event.processing_status === 'processed' || event.processing_status === 'ignored') return;
  try {
    const msg = await queryOne<{ id: string; status: RcsStatus; campaign_id: string | null }>(
      `SELECT id,status,campaign_id FROM rcs_messages WHERE vendor_id=$1 AND provider_message_id=$2`,
      [event.vendor_id, job.normalized.provider_message_id],
    );
    if (!msg) {
      await pool.query(`UPDATE rcs_webhook_events SET processing_status='ignored',error='message not found',processed_at=now() WHERE id=$1`, [event.id]);
      return;
    }
    let advanced = false;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const current = await db.query('SELECT status FROM rcs_messages WHERE id=$1 FOR UPDATE', [msg.id]);
      const oldStatus = current.rows[0]?.status as RcsStatus | undefined;
      if (oldStatus && shouldAdvanceStatus(oldStatus, job.normalized.status)) {
        const result = await db.query(
          `UPDATE rcs_messages SET status=$1,error_code=$2,error_description=$3,
            dlr_time=CASE WHEN $1 IN ('delivered','undelivered','expired','rejected','failed') THEN COALESCE($4::timestamptz,now()) ELSE dlr_time END,
            updated_at=now() WHERE id=$5`,
          [job.normalized.status, job.normalized.error_code ?? null, job.normalized.error_description ?? null,
            job.normalized.delivered_at ?? null, msg.id],
        );
        advanced = Boolean(result.rowCount);
      }
      await db.query(`UPDATE rcs_webhook_events SET processing_status='processed',processed_at=now(),error=NULL WHERE id=$1`, [event.id]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; } finally { db.release(); }
    if (!advanced) return;
    if (TERMINAL_FAILURES.has(job.normalized.status)) {
      await getAnyRcsQueue(RCS_QUEUES.billing).add('settle', { message_id: msg.id, outcome: 'failed' } satisfies BillingJob, { jobId: `dlr-failure:${event.id}` });
    } else if (job.normalized.status === 'delivered') {
      await getAnyRcsQueue(RCS_QUEUES.billing).add('settle', { message_id: msg.id, outcome: 'delivered' } satisfies BillingJob, { jobId: `delivery:${event.id}` });
    }
    if (msg.campaign_id) await refreshCampaign(msg.campaign_id);
  } catch (error) {
    await pool.query(`UPDATE rcs_webhook_events SET processing_status='failed',error=$1 WHERE id=$2`, [(error as Error).message.slice(0, 500), event.id]);
    throw error;
  }
}

async function billingMode(msg: Pick<MessageRow, 'campaign_id'>): Promise<'on_submission' | 'on_delivery'> {
  let value: string | undefined;
  if (msg.campaign_id) {
    const mode = await queryOne<{ billing_mode: string }>('SELECT billing_mode FROM rcs_campaigns WHERE id=$1', [msg.campaign_id]);
    value = mode?.billing_mode;
  } else {
    const setting = await queryOne<{ value: string }>(`SELECT value #>> '{}' AS value FROM rcs_settings WHERE key='default_billing_mode'`);
    value = setting?.value;
  }
  return value === 'on_delivery' ? 'on_delivery' : 'on_submission';
}

async function settleBilling(job: BillingJob): Promise<void> {
  const msg = await readMessage(job.message_id);
  if (!msg) return;
  const mode = await billingMode(msg);
  if (job.outcome === 'submitted' && mode !== 'on_submission') { if (msg.campaign_id) await refreshCampaign(msg.campaign_id); return; }
  if (job.outcome === 'delivered' && mode !== 'on_delivery') { if (msg.campaign_id) await refreshCampaign(msg.campaign_id); return; }
  if (job.outcome === 'failed' && mode === 'on_submission' && msg.billing_state === 'charged') { if (msg.campaign_id) await refreshCampaign(msg.campaign_id); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const eventKey = `settle:${msg.id}:${msg.billing_cycle}:${job.outcome}`;
    const prior = await db.query('SELECT 1 FROM rcs_ledger WHERE event_key=$1', [eventKey]);
    if (prior.rowCount) { await db.query('COMMIT'); return; }
    const reservations = await db.query(
      `SELECT id,campaign_id,message_id,amount,consumed_amount,released_amount,state
         FROM rcs_billing_reservations
        WHERE (message_id=$1 OR campaign_id=$2) AND state='held'
        ORDER BY (message_id IS NOT NULL) DESC LIMIT 1 FOR UPDATE`, [msg.id, msg.campaign_id],
    );
    if (!reservations.rowCount) { await db.query('COMMIT'); return; }
    const priorAfterLock = await db.query('SELECT 1 FROM rcs_ledger WHERE event_key=$1', [eventKey]);
    if (priorAfterLock.rowCount) { await db.query('COMMIT'); return; }
    const reservation = reservations.rows[0];
    const campaignReservation = Boolean(reservation.campaign_id);
    const walletResult = await db.query('SELECT balance,reserved,currency FROM rcs_wallets WHERE client_id=$1 FOR UPDATE', [msg.client_id]);
    if (!walletResult.rowCount) throw new Error(`missing RCS wallet for ${msg.client_id}`);
    const wallet = walletResult.rows[0];
    const availableHeld = campaignReservation
      ? Number(reservation.amount) - Number(reservation.consumed_amount) - Number(reservation.released_amount)
      : Number(reservation.amount);
    const heldAmount = Math.min(Math.max(0, availableHeld), Number(msg.price));
    if (heldAmount <= 0) { await db.query('COMMIT'); return; }
    const chargeAmount = job.outcome === 'failed' ? 0 : Math.min(Number(msg.price), heldAmount);
    const releaseAmount = heldAmount - chargeAmount;
    const newBalance = Number(wallet.balance) - chargeAmount;
    const newReserved = Math.max(0, Number(wallet.reserved) - heldAmount);
    await db.query('UPDATE rcs_wallets SET balance=$1,reserved=$2,updated_at=now() WHERE client_id=$3', [newBalance, newReserved, msg.client_id]);
    if (campaignReservation) {
      await db.query(
        `UPDATE rcs_billing_reservations
            SET consumed_amount=consumed_amount+$1,released_amount=released_amount+$2,
                state=CASE WHEN consumed_amount+released_amount+$1+$2>=amount
                  THEN CASE WHEN consumed_amount+$1=0 THEN 'released' ELSE 'consumed' END ELSE 'held' END,
                settled_at=CASE WHEN consumed_amount+released_amount+$1+$2>=amount THEN now() ELSE settled_at END
          WHERE id=$3`, [chargeAmount, releaseAmount, reservation.id],
      );
    } else {
      await db.query(
        `UPDATE rcs_billing_reservations SET consumed_amount=$1,released_amount=$2,state=$3,settled_at=now() WHERE id=$4`,
        [chargeAmount, releaseAmount, chargeAmount > 0 ? 'consumed' : 'released', reservation.id],
      );
    }
    const ledgerType = chargeAmount > 0 ? 'charge' : 'release';
    const ledgerAmount = chargeAmount > 0 ? chargeAmount : releaseAmount;
    const ledger = await db.query(
      `INSERT INTO rcs_ledger(client_id,reservation_id,message_id,campaign_id,type,amount,balance_after,reserved_after,event_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
      [msg.client_id, reservation.id, msg.id, msg.campaign_id, ledgerType, ledgerAmount, newBalance, newReserved, eventKey],
    );
    if (ledger.rowCount && chargeAmount > 0) {
      await db.query(
        `INSERT INTO rcs_billing_records(client_id,message_id,campaign_id,event_key,amount,currency,billing_mode,event_type)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key) DO NOTHING`,
        [msg.client_id, msg.id, msg.campaign_id, eventKey, chargeAmount, wallet.currency, mode, job.outcome === 'delivered' ? 'delivery' : 'submission'],
      );
    }
    await db.query(`UPDATE rcs_messages SET billing_state=$1,updated_at=now() WHERE id=$2`, [chargeAmount > 0 ? 'charged' : 'released', msg.id]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; } finally { db.release(); }
  if (msg.campaign_id) await refreshCampaign(msg.campaign_id);
}

async function expandCampaign(campaignId: string, afterRecipientId: string | null = null): Promise<void> {
  const campaign = await queryOne<{ id: string; client_id: string; sender: string; content: RcsContent; status: string }>(
    'SELECT id,client_id,sender,content,status FROM rcs_campaigns WHERE id=$1', [campaignId],
  );
  if (!campaign || !['queued', 'processing'].includes(campaign.status)) return;
  await pool.query(`UPDATE rcs_campaigns SET status='processing',updated_at=now() WHERE id=$1 AND status='queued'`, [campaignId]);
  const recipients = await pool.query(
    `SELECT id,destination FROM rcs_campaign_recipients
      WHERE campaign_id=$1 AND validation_status='valid' AND message_id IS NULL
        AND ($2::bigint IS NULL OR id>$2::bigint)
      ORDER BY id LIMIT $3`,
    [campaignId, afterRecipientId, CAMPAIGN_BATCH_SIZE],
  );
  if (!recipients.rowCount) { await refreshCampaign(campaignId); return; }
  for (const recipient of recipients.rows as Array<{ id: string; destination: string }>) {
    const country = await queryOne<{ id: string }>(
      `SELECT id FROM countries WHERE status='active' AND $1 LIKE '+'||calling_code||'%' ORDER BY length(calling_code) DESC LIMIT 1`, [recipient.destination],
    );
    if (!country) {
      await pool.query(`UPDATE rcs_campaign_recipients SET validation_status='unsupported_country',reason='country no longer supported' WHERE id=$1`, [recipient.id]);
      continue;
    }
    const rate = await queryOne<{ price: string }>(
      `SELECT price::text FROM rcs_rates WHERE client_id=$1 AND country_id=$2 AND effective_from<=now() ORDER BY effective_from DESC LIMIT 1`,
      [campaign.client_id, country.id],
    );
    if (!rate) {
      await pool.query(`UPDATE rcs_campaign_recipients SET validation_status='invalid',reason='RCS rate is not configured' WHERE id=$1`, [recipient.id]);
      continue;
    }
    const id = cryptoRandomUUID();
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const activeCampaign = await tx.query(`SELECT status FROM rcs_campaigns WHERE id=$1 FOR UPDATE`, [campaignId]);
      if (!activeCampaign.rowCount || activeCampaign.rows[0].status === 'cancelled' || activeCampaign.rows[0].status === 'failed') {
        await tx.query('COMMIT');
        break;
      }
      const inserted = await tx.query(
        `INSERT INTO rcs_messages(id,client_id,campaign_id,idempotency_key,sender,destination,country_id,content,status,price,billing_state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,'reserved')
         ON CONFLICT(client_id,idempotency_key) DO NOTHING RETURNING id`,
        [id, campaign.client_id, campaignId, `campaign:${campaignId}:${recipient.id}`, campaign.sender, recipient.destination, country.id, JSON.stringify(campaign.content), rate.price],
      );
      if (inserted.rowCount) {
        await tx.query(`INSERT INTO rcs_outbox(message_id,queue_name,dispatch_key) VALUES($1,$2,'initial') ON CONFLICT DO NOTHING`, [id, RCS_QUEUES.route]);
        await tx.query(`UPDATE rcs_campaign_recipients SET message_id=$1 WHERE id=$2 AND message_id IS NULL`, [id, recipient.id]);
      } else {
        const old = await tx.query(`SELECT id FROM rcs_messages WHERE client_id=$1 AND idempotency_key=$2`, [campaign.client_id, `campaign:${campaignId}:${recipient.id}`]);
        if (old.rowCount) await tx.query(`UPDATE rcs_campaign_recipients SET message_id=$1 WHERE id=$2 AND message_id IS NULL`, [old.rows[0].id, recipient.id]);
      }
      await tx.query('COMMIT');
    } catch (error) { await tx.query('ROLLBACK').catch(() => undefined); throw error; } finally { tx.release(); }
  }
  const nextCursor = String(recipients.rows[recipients.rowCount - 1].id);
  await getAnyRcsQueue(RCS_QUEUES.campaign).add('expand', { campaign_id: campaignId, after_recipient_id: nextCursor }, { jobId: `${campaignId}:after:${nextCursor}` });
}

async function refreshCampaign(campaignId: string): Promise<void> {
  const counts = await queryOne<{ total: string; terminal: string; failed: string }>(
    `SELECT count(*) AS total,
       count(*) FILTER (WHERE m.status IN ('delivered','undelivered','expired','rejected','failed')) AS terminal,
       count(*) FILTER (WHERE m.status IN ('undelivered','expired','rejected','failed')) AS failed
     FROM rcs_campaign_recipients cr LEFT JOIN rcs_messages m ON m.id=cr.message_id
     WHERE cr.campaign_id=$1 AND cr.validation_status='valid'`, [campaignId],
  );
  const missing = await queryOne<{ count: string }>(`SELECT count(*) AS count FROM rcs_campaign_recipients WHERE campaign_id=$1 AND validation_status='valid' AND message_id IS NULL`, [campaignId]);
  if (Number(counts?.total ?? 0) && Number(counts?.terminal ?? 0) === Number(counts?.total ?? 0) && Number(missing?.count ?? 0) === 0) {
    await pool.query(`UPDATE rcs_campaigns SET status='completed',updated_at=now() WHERE id=$1 AND status NOT IN ('cancelled','failed')`, [campaignId]);
    await releaseCampaignRemainder(campaignId);
  }
  await pool.query(
    `UPDATE rcs_campaigns SET accepted_count=$2,rejected_count=$3,updated_at=now() WHERE id=$1`,
    [campaignId, Number(counts?.total ?? 0), Number(counts?.failed ?? 0)],
  );
}

async function releaseCampaignRemainder(campaignId: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const reservation = await db.query(`SELECT * FROM rcs_billing_reservations WHERE campaign_id=$1 AND state='held' FOR UPDATE`, [campaignId]);
    if (!reservation.rowCount) { await db.query('COMMIT'); return; }
    const r = reservation.rows[0];
    const remaining = Math.max(0, Number(r.amount) - Number(r.consumed_amount ?? 0) - Number(r.released_amount ?? 0));
    const wallet = await db.query('SELECT balance,reserved FROM rcs_wallets WHERE client_id=$1 FOR UPDATE', [r.client_id]);
    if (!wallet.rowCount) throw new Error('missing campaign wallet');
    const reserved = Math.max(0, Number(wallet.rows[0].reserved) - remaining);
    await db.query('UPDATE rcs_wallets SET reserved=$1,updated_at=now() WHERE client_id=$2', [reserved, r.client_id]);
    await db.query(`UPDATE rcs_billing_reservations SET released_amount=released_amount+$1,state='released',settled_at=now() WHERE id=$2`, [remaining, r.id]);
    await db.query(
      `INSERT INTO rcs_ledger(client_id,reservation_id,campaign_id,type,amount,balance_after,reserved_after,event_key)
       VALUES($1,$2,$3,'release',$4,$5,$6,$7) ON CONFLICT(event_key) DO NOTHING`,
      [r.client_id, r.id, campaignId, remaining, wallet.rows[0].balance, reserved, `campaign-release:${campaignId}`],
    );
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; } finally { db.release(); }
}

async function dispatchOutbox(): Promise<number> {
  const db = await pool.connect();
  let count = 0;
  try {
    await db.query('BEGIN');
    const rows = await db.query(
      `SELECT id,message_id,queue_name,dispatch_key FROM rcs_outbox WHERE state='pending' ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows.rows as Array<{ id: string; message_id: string; queue_name: string; dispatch_key: string }>) {
      if (row.queue_name !== RCS_QUEUES.route) throw new Error(`unsupported RCS outbox queue ${row.queue_name}`);
      await getAnyRcsQueue(row.queue_name).add('route', { message_id: row.message_id } satisfies MessageJob, { jobId: `${row.message_id}:outbox:${row.dispatch_key}` });
      await db.query(`UPDATE rcs_outbox SET state='published',attempts=attempts+1,published_at=now() WHERE id=$1`, [row.id]);
      count++;
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; } finally { db.release(); }
  return count;
}

function cryptoRandomUUID(): string { return globalThis.crypto.randomUUID(); }
async function campaignProcessor(job: { data: { campaign_id: string; after_recipient_id?: string | null; action?: string }; name?: string }): Promise<void> {
  if (job.data.action === 'cancel' || job.name === 'cancel') {
    await pool.query(`UPDATE rcs_campaigns SET status='cancelled',updated_at=now() WHERE id=$1 AND status IN ('queued','processing','paused')`, [job.data.campaign_id]);
    await releaseCampaignRemainder(job.data.campaign_id);
    return;
  }
  await expandCampaign(job.data.campaign_id, job.data.after_recipient_id ?? null);
}

async function main(): Promise<void> {
  createWorker<MessageJob>(RCS_QUEUES.route, async ({ data }) => routeMessage(data), Number(process.env.RCS_ROUTE_CONCURRENCY ?? 50));
  createWorker<SendJob>(RCS_QUEUES.vendorSend, async ({ data }) => sendMessage(data), Number(process.env.RCS_SEND_CONCURRENCY ?? 50));
  createWorker<WebhookJob>(RCS_QUEUES.webhook, async ({ data }) => processWebhook(data), Number(process.env.RCS_WEBHOOK_CONCURRENCY ?? 25));
  createWorker<BillingJob>(RCS_QUEUES.billing, async ({ data }) => settleBilling(data), Number(process.env.RCS_BILLING_CONCURRENCY ?? 25));
  createWorker<{ campaign_id: string; offset?: number; action?: string }>(RCS_QUEUES.campaign, async (job) => campaignProcessor(job), Number(process.env.RCS_CAMPAIGN_CONCURRENCY ?? 4));
  const dispatch = async (): Promise<void> => {
    try { await dispatchOutbox(); } catch (error) { console.error('[rcs-worker] outbox dispatch failed', (error as Error).message); }
  };
  await dispatch();
  setInterval(() => { void dispatch(); }, Number(process.env.RCS_OUTBOX_POLL_MS ?? 1000)).unref();
  console.log('[8xtelSMPP rcs-worker] started');
}

main().catch((error) => { console.error('[rcs-worker] fatal', error); process.exit(1); });
