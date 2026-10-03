import {
  createWorker, getQueue, QUEUES, getPool, tryAcquireTps, incrStat, analyzeSms, requeueSubmit, type MessageJob,
  resolveCuttingConfig, shouldSelectForDelay,
} from '@8xtel/core';
import { resolveCountry, applyFilters, findRoutes, orderVendors, recordEvent } from './engine.js';
import { tryOtpTransform } from './otp.js';

// ── Routing worker: sms:submit → route → sms:vendor-send (§15, Phase 3) ──────
// Fails over across the ordered vendor chain at SEND time (vendor-worker
// re-queues with next index); here we attach the chain + pricing snapshot.

async function handleJob(job: { data: MessageJob }): Promise<void> {
  let msg = job.data;
  const pool = getPool();

  // Balance pre-check FIRST: a client with no funds must never see their
  // message sit `submitted` — reject immediately with a clear reason, before
  // any TPS pacing or queue delay. Binds are checked once at bind time
  // (smpp-server/auth.ts); this covers the balance running dry mid-session.
  const gateRow = await pool.query(
    `SELECT c.status, c.balance, c.credit_limit,
            COALESCE(c.billing_mode,'prepay') AS billing_mode,
            COALESCE(w.sms_credits,0) AS sms_credits
     FROM clients c LEFT JOIN wallets w ON w.client_id=c.id WHERE c.id=$1`,
    [msg.client_id],
  );
  const gate = gateRow.rows[0] as {
    status: string; balance: string; credit_limit: string;
    billing_mode: string; sms_credits: string;
  } | undefined;
  if (!gate || gate.status !== 'active') {
    await pool.query(`UPDATE messages SET status='rejected', error_description=$1 WHERE id=$2`, [
      !gate ? 'unknown client' : `account ${gate.status}`, msg.internal_id,
    ]);
    await recordEvent(msg.internal_id, null, 'failed', `balance gate: ${!gate ? 'unknown client' : gate.status}`);
    await incrStat('rejected');
    return;
  }
  if (gate.billing_mode === 'credit') {
    if (Number(gate.sms_credits) < 1) {
      await pool.query(
        `UPDATE messages SET status='rejected', error_description='insufficient SMS credits — please top up' WHERE id=$1`,
        [msg.internal_id],
      );
      await recordEvent(msg.internal_id, null, 'failed', 'balance gate: no SMS credits');
      await incrStat('rejected');
      return;
    }
  } else if (Number(gate.balance) + (gate.billing_mode === 'postpay' ? Number(gate.credit_limit) : 0) <= 0) {
    await pool.query(
      `UPDATE messages SET status='rejected', error_description='insufficient balance — please top up' WHERE id=$1`,
      [msg.internal_id],
    );
    await recordEvent(msg.internal_id, null, 'failed', 'balance gate: insufficient balance');
    await incrStat('rejected');
    return;
  }

  const clientRow = await pool.query(
    'SELECT tps_limit FROM clients WHERE id=$1', [msg.client_id],
  );
  const clientTps: number = Number(clientRow.rows[0]?.tps_limit ?? 0);
  if (clientTps > 0 && !(await tryAcquireTps(`client:${msg.client_id}`, clientTps))) {
    const jitter = 1000 + Math.floor(Math.random() * 2000);
    await requeueSubmit(msg, { delay: jitter });
    return;
  }

  const country = await resolveCountry(msg.destination);
  const countryId = country?.id ?? null;

  // ── Routing rules (MCC/MNC/sender/type/source/time) steer selection ──────
  let ruleVendorHint: string | null = null;
  let activeRuleId: string | null = null;
  try {
    const { resolveRoutingRule } = await import('./engine.js');
    // classify message type from text (otp if 4-6 digit code present)
    const isOtp = /\b\d{4,6}\b/.test(msg.text ?? '');
    const mtype = isOtp ? 'otp' : 'promotional';
    const rr = await resolveRoutingRule({
      countryId, sender: msg.source, messageType: mtype,
      sourceType: (msg as unknown as { source_type?: string }).source_type ?? 'smpp',
    });
    if (rr?.route_id) { ruleVendorHint = rr.route_id; activeRuleId = rr.id; }
    else if (rr?.route_group_id) {
      // group → pick one route from members (weighted, exact counter)
      const gm = await pool.query(`SELECT route_id, weight FROM route_group_members WHERE group_id=$1 ORDER BY priority`, [rr.route_group_id]);
      if (gm.rows.length) {
        const total = gm.rows.reduce((s: number, r: { weight: number }) => s + r.weight, 0) || 1;
        let ctr = 0;
        try { const { getRedis } = await import('@8xtel/core'); ctr = Number(await getRedis().incr(`gdist:${rr.route_group_id}`)); if (ctr > 10_000_000) await getRedis().set(`gdist:${rr.route_group_id}`, String(ctr % total)); } catch { ctr = Math.floor(Math.random() * total) + 1; }
        const roll = ((ctr - 1) % total + total) % total;
        let acc = 0; let pick = gm.rows[0].route_id;
        for (const r of gm.rows) { acc += r.weight; if (roll < acc) { pick = r.route_id; break; } }
        ruleVendorHint = pick; activeRuleId = rr.id;
      }
    }
  } catch { /* best-effort */ }

  const filter = await applyFilters(msg.client_id, msg.destination, msg.source, countryId);
  if (filter.action === 'block' || filter.action === 'reject') {
    await pool.query(`UPDATE messages SET status='rejected', error_description=$1 WHERE id=$2`, [
      `filtered:${filter.action}`, msg.internal_id,
    ]);
    await recordEvent(msg.internal_id, null, 'failed', `filter ${filter.action}`);
    await incrStat('rejected');
    return;
  }

  const forceRouteId = (msg as { force_route_id?: string | null }).force_route_id ?? null;
  const forceVendorId = (msg as { force_vendor_id?: string | null }).force_vendor_id ?? null;

  let candidates = await findRoutes(msg.client_id, msg.channel, countryId, msg.destination, msg.source);
  // Routing-rule override: pin to rule's route if present (takes priority over filter reroute, but not over force)
  if (ruleVendorHint && !forceRouteId && !forceVendorId) {
    const pinned = candidates.find((c) => c.route_id === ruleVendorHint);
    if (pinned) candidates = [pinned, ...candidates.filter((c) => c.route_id !== pinned.route_id)];
    else {
      const forced = await pool.query('SELECT id, name, strategy FROM routes WHERE id=$1', [ruleVendorHint]);
      if (forced.rowCount) {
        const r = forced.rows[0];
        const vendors = await pool.query(
          `SELECT v.id AS vendor_id, v.name AS vendor_name, rv.priority, rv.weight, NULL AS cost, v.tps
           FROM route_vendors rv JOIN vendors v ON v.id=rv.vendor_id WHERE rv.route_id=$1 ORDER BY rv.priority`, [ruleVendorHint],
        );
        candidates = [{ route_id: r.id, route_name: `${r.name} (rule)`, strategy: r.strategy, vendors: vendors.rows }, ...candidates];
      }
    }
  }
  // Test override (Send Test SMS page): force a route, optionally a single vendor.
  // Skips route matching AND reroute filters; block/reject filters above still apply.
  if (forceRouteId || forceVendorId) {
    const forced = forceRouteId
      ? await pool.query('SELECT id, name, strategy FROM routes WHERE id=$1', [forceRouteId])
      : { rowCount: 0, rows: [] as Array<{ id: string; name: string; strategy: string }> };
    if (forceRouteId && !forced.rowCount) {
      await pool.query(`UPDATE messages SET status='failed', error_description='forced route not found', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
      await recordEvent(msg.internal_id, null, 'failed', `forced route ${forceRouteId} not found`);
      await incrStat('failed');
      return;
    }
    if (forceVendorId) {
      const v = await pool.query(
        `SELECT v.id AS vendor_id, v.name AS vendor_name, 1 AS priority, 100 AS weight, NULL AS cost, v.tps
         FROM vendors v WHERE v.id=$1 AND v.status='enabled'`,
        [forceVendorId],
      );
      if (!v.rowCount) {
        await pool.query(`UPDATE messages SET status='failed', error_description='forced vendor not available', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
        await recordEvent(msg.internal_id, null, 'failed', `forced vendor ${forceVendorId} not found/disabled`);
        await incrStat('failed');
        return;
      }
      const r = forced.rowCount ? forced.rows[0] : { id: null as string | null, name: 'forced vendor', strategy: 'priority' };
      candidates = [{
        route_id: r.id ?? forceRouteId ?? '',
        route_name: `${r.name} (forced)`,
        strategy: r.strategy,
        vendors: v.rows,
      }];
    } else if (forced.rowCount) {
      const r = forced.rows[0];
      const vendors = await pool.query(
        `SELECT v.id AS vendor_id, v.name AS vendor_name, rv.priority, rv.weight, NULL AS cost, v.tps
         FROM route_vendors rv JOIN vendors v ON v.id=rv.vendor_id WHERE rv.route_id=$1 ORDER BY rv.priority`,
        [forceRouteId],
      );
      candidates = [{ route_id: r.id, route_name: `${r.name} (forced)`, strategy: r.strategy, vendors: vendors.rows }];
    }
  } else if (filter.action === 'reroute' && filter.reroute_id) {
    const forced = await pool.query('SELECT id, name, strategy FROM routes WHERE id=$1', [filter.reroute_id]);
    if (forced.rowCount) {
      const r = forced.rows[0];
      const vendors = await pool.query(
        `SELECT v.id AS vendor_id, v.name AS vendor_name, rv.priority, rv.weight, NULL AS cost, v.tps
         FROM route_vendors rv JOIN vendors v ON v.id=rv.vendor_id WHERE rv.route_id=$1 ORDER BY rv.priority`,
        [filter.reroute_id],
      );
      candidates = [{ route_id: r.id, route_name: r.name, strategy: r.strategy, vendors: vendors.rows }];
    }
  }

  if (!candidates.length) {
    await pool.query(`UPDATE messages SET status='failed', error_description='no route', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
    await recordEvent(msg.internal_id, null, 'failed', `no route found (country=${country?.name ?? 'unknown'})`);
    await incrStat('failed');
    return;
  }

  const chosen = candidates[0];
  const chain = await orderVendors(chosen);
  // Forced-vendor-only path has no route row (route_id stays NULL on the message)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chosen.route_id);
  // ── OTP Sender ID & Template Mapping (India HSP, opt-in per route) ───────
  // Runs AFTER route match, BEFORE pricing/TPS/vendor-send: the transformed
  // text is what gets billed, segmented and submitted upstream. Client
  // message-id, DLR flow and accounting key off internal_id — untouched.
  // Only real route rows participate (forced-vendor test path skips it).
  if (isUuid) {
    const otpRes = await tryOtpTransform(chosen.route_id, msg.client_id, msg.source, msg.text);
    if (otpRes.ok) {
      const t = otpRes.transform;
      await pool.query(
        `UPDATE messages SET original_source=$1, original_text=$2, extracted_otp=$3,
                otp_template_id=$4, otp_transformed=true, source=$5, text=$6 WHERE id=$7`,
        [msg.source, msg.text, t.otp, t.template.id, t.finalSource, t.finalText, msg.internal_id],
      );
      await recordEvent(
        msg.internal_id, chain[0]?.vendor_id ?? null, 'otp-transform',
        `otp=${t.otp} template="${t.template.name}" ${msg.source}→${t.finalSource}`,
      );
      msg = { ...msg, source: t.finalSource, text: t.finalText };
    } else if (otpRes.fallback === 'reject' && otpRes.reason !== 'otp transform not enabled') {
      await pool.query(`UPDATE messages SET status='rejected', error_description=$1 WHERE id=$2`, [
        `otp-transform: ${otpRes.reason}`, msg.internal_id,
      ]);
      await recordEvent(msg.internal_id, null, 'failed', `otp-transform rejected: ${otpRes.reason}`);
      await incrStat('rejected');
      return;
    }
    // 'passthrough' → fall through to existing logic byte-identical.
  }

  // Route TPS guard (§18) — requeue with delay instead of dropping
  const routeRow = isUuid
    ? await pool.query('SELECT tps_limit FROM routes WHERE id=$1', [chosen.route_id])
    : { rows: [] as Array<{ tps_limit: number | null }> };
  const routeTps: number | null = routeRow.rows[0]?.tps_limit ?? null;
  if (routeTps && !(await tryAcquireTps(`route:${chosen.route_id}`, routeTps))) {
    await requeueSubmit(msg, { delay: 1000 });
    return;
  }

  // ── Pricing: route price × segments wins, else client_rates (§13) ─────────
  // Segments come from the pre-send analysis (data_coding 8 = unicode).
  const digits = msg.destination.replace(/\D/g, '');
  const segInfo = analyzeSms(msg.text);
  const segments = segInfo.segments;
  let clientPrice: string | null = null;
  let priceSource = 'none';
  if (isUuid) {
    // Highest priority: per-client route override (country-specific > generic)
    const rcr = await pool.query(
      `SELECT price_per_segment FROM route_client_rates
       WHERE route_id=$1 AND client_id=$2
         AND (country_id IS NULL OR country_id=$3)
       ORDER BY country_id NULLS LAST LIMIT 1`,
      [chosen.route_id, msg.client_id, countryId],
    );
    const rcrPrice = rcr.rows[0]?.price_per_segment;
    if (rcrPrice !== null && rcrPrice !== undefined) {
      clientPrice = String(Number(rcrPrice) * segments);
      priceSource = `per-client ${chosen.route_name} × ${segments}seg`;
    } else {
      const rp = await pool.query(
        'SELECT price_per_segment FROM routes WHERE id=$1', [chosen.route_id],
      );
      const pp = rp.rows[0]?.price_per_segment;
      if (pp !== null && pp !== undefined) {
        clientPrice = String(Number(pp) * segments);
        priceSource = `route:${chosen.route_name} × ${segments}seg`;
      }
    }
  }
  if (clientPrice === null) {
    const priceRow = await pool.query(
      `SELECT cr.price FROM client_rates cr JOIN clients c ON c.pricing_profile_id=cr.profile_id
       WHERE c.id=$1 AND ($2 LIKE COALESCE(cr.prefix,'') || '%' OR cr.country_id=$3)
       ORDER BY length(COALESCE(cr.prefix,'')) DESC LIMIT 1`,
      [msg.client_id, digits, countryId],
    );
    if (priceRow.rows[0]?.price !== undefined) {
      clientPrice = String(Number(priceRow.rows[0].price) * segments);
      priceSource = `client_rates × ${segments}seg`;
    }
  }
  // ── Billing mode: longest-prefix match on the client's saved rate card ────
  // (client → country → network/MCC/MNC → rate). Falls back to on_submission
  // so old traffic bills exactly as before. Stamped on the message + passed
  // down the chain so vendor-send and the billing engine honor it.
  let billingMode = 'on_submission';
  let deliveryRate: number | null = null;
  {
    const bm = await pool.query(
      `SELECT billing_mode, delivery_rate FROM client_saved_rates
       WHERE client_id=$1 AND ($2 LIKE country || '%' OR $2 LIKE '%' || mcc || '%' OR country_id IS NULL)
       ORDER BY length(COALESCE(network_name,'')) DESC LIMIT 1`,
      [msg.client_id, digits],
    ).catch(() => ({ rows: [] as Array<{ billing_mode: string; delivery_rate: string | null }> }));
    // Prefix match above is best-effort; do a precise longest match in code
    // over the small per-client card (country name won't prefix-match digits,
    // so match on MCC digits + network specificity instead).
    const card = await pool.query(
      `SELECT billing_mode, delivery_rate, mcc, mnc, network_name FROM client_saved_rates
       WHERE client_id=$1`, [msg.client_id],
    ).catch(() => ({ rows: [] as Array<{ billing_mode: string; delivery_rate: string | null; mcc: string; mnc: string; network_name: string }> }));
    let best = -1;
    for (const r of card.rows) {
      const mccHit = r.mcc && digits.includes(r.mcc) ? r.mcc.length + 10 : -1;
      const score = mccHit + (r.mnc && r.mnc !== 'ALL' ? 5 : 0) + Math.min((r.network_name ?? '').length, 10) / 10;
      if (mccHit >= 0 && score > best) {
        best = score;
        billingMode = r.billing_mode ?? 'on_submission';
        deliveryRate = r.delivery_rate !== null && r.delivery_rate !== undefined ? Number(r.delivery_rate) : null;
      }
    }
    void bm;
  }
  // Delivery-only modes must NOT hold funds at submit — nothing is owed until
  // the delivered DLR lands. Submit-billed modes keep the existing hold.
  const { billsOnSubmit } = await import('@8xtel/core');
  const submitBilled = billsOnSubmit(billingMode as never);
  const reserveAmount = submitBilled ? Number(clientPrice ?? 0) : 0;
  // ── DLR Cutting selection ──────────────────────────────────────────────
  let cuttingSelected = false;
  let cuttingConfigId: string | null = null;
  let cuttingDelaySec: number | null = null;
  try {
    const cfg = await resolveCuttingConfig({ route_id: isUuid ? chosen.route_id : null, client_id: msg.client_id, country_id: countryId });
    if (cfg) {
      const sel = await shouldSelectForDelay(cfg as never);
      cuttingSelected = sel.selected;
      cuttingConfigId = cfg.id;
      cuttingDelaySec = cfg.delay_seconds;
    }
  } catch { /* never block routing */ }

  // ── Credit-mode reservation: 1 credit per segment, no money moves ─────────
  // Clients with billing_mode='credit' burn SMS credits instead of funds.
  // Same hold/settle/refund shape as money (reserved_credits on messages,
  // credit_transactions ledger) but the money hold below is skipped.
  let reserveCredits = 0;
  {
    const wmode = await pool.query(
      'SELECT billing_mode FROM wallets WHERE client_id=$1', [msg.client_id],
    );
    if ((wmode.rows[0]?.billing_mode ?? 'prepay') === 'credit') {
      reserveCredits = segments;
      // Single-statement CTE — same pool-starvation rationale as money below.
      const held = await pool.query(
        `WITH w AS (
           SELECT sms_credits FROM wallets WHERE client_id=$1 FOR UPDATE
         ), upd AS (
           UPDATE wallets
           SET sms_credits = (SELECT sms_credits FROM w) - $2, updated_at=now()
           WHERE client_id=$1 AND (SELECT sms_credits FROM w) >= $2
           RETURNING sms_credits
         )
         SELECT (SELECT sms_credits FROM upd) AS after,
                (SELECT sms_credits FROM w) AS before`,
        [msg.client_id, reserveCredits],
      );
      const cr = held.rows[0] as { after: string | null; before: string | null };
      if (cr.before === null) {
        await pool.query(`UPDATE messages SET status='failed', error_description='no wallet', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
        await recordEvent(msg.internal_id, null, 'failed', 'no wallet for credit reservation');
        await incrStat('failed');
        return;
      }
      if (cr.after === null) {
        await pool.query(`UPDATE messages SET status='rejected', error_description='insufficient SMS credits — please top up', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
        await recordEvent(msg.internal_id, null, 'failed', `credit reservation failed: need ${reserveCredits}, have ${cr.before}`);
        await incrStat('rejected');
        return;
      }
      const afterNum = +Number(cr.after).toFixed(2);
      await pool.query('UPDATE clients SET sms_credits=$1 WHERE id=$2', [afterNum, msg.client_id]);
      await pool.query(
        `INSERT INTO credit_transactions (client_id, message_id, type, amount, balance_after, description, remark)
         VALUES ($1,$2,'burn',$3,$4,$5,$6)`,
        [msg.client_id, msg.internal_id, -reserveCredits, afterNum,
         `SMS credit hold ${msg.internal_id.slice(0, 8)} (${segments} seg)`,
         `Reserved at submit · ${segments} credit(s)`],
      );
    }
  }

  // ── Submit-time reservation: hold funds NOW, settle on outcome (§28) ──────
  // Atomic: only proceed if wallet covers the hold (prepay floor 0,
  // postpay floor -credit_limit). Concurrent submits serialize on the row lock.
  // Skipped for credit-mode clients (credits held above instead).
  // Single-statement CTE: no pool.connect() checkout, so 20-way concurrency
  // can never pool-starve (PG_POOL_MAX=5 + pool.connect() = 15 jobs hanging
  // forever holding the BullMQ lock — the Sept 2026 8k-stuck incident).
  if (reserveAmount > 0 && reserveCredits === 0) {
    const held = await pool.query(
      `WITH w AS (
         SELECT balance, credit_limit, billing_mode, currency FROM wallets
         WHERE client_id=$1 FOR UPDATE
       ), upd AS (
         UPDATE wallets
         SET balance = (SELECT balance FROM w) - $2, updated_at=now()
         WHERE client_id=$1
           AND (SELECT balance FROM w) - $2 >=
               CASE WHEN (SELECT billing_mode FROM w)='postpay'
                    THEN -(SELECT credit_limit FROM w) ELSE 0 END
         RETURNING balance
       )
       SELECT (SELECT balance FROM upd) AS after,
              (SELECT balance FROM w) AS before,
              (SELECT currency FROM w) AS currency,
              (SELECT billing_mode FROM w) AS billing_mode,
              (SELECT credit_limit FROM w) AS credit_limit`,
      [msg.client_id, reserveAmount],
    );
    const r = held.rows[0] as {
      after: string | null; before: string; currency: string;
      billing_mode: string; credit_limit: string;
    };
    if (r.after === null) {
      await pool.query(`UPDATE messages SET status='rejected', error_description='insufficient balance — please top up', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
      await recordEvent(msg.internal_id, null, 'failed', `reservation failed: need ${reserveAmount}, have ${r.before}`);
      await incrStat('rejected');
      return;
    }
    await pool.query('UPDATE clients SET balance=$1 WHERE id=$2', [r.after, msg.client_id]);
    await pool.query(
      `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description, remark, currency)
       VALUES ($1,$2,'debit',$3,$4,$5,$6,$7)`,
      [msg.client_id, msg.internal_id, -reserveAmount, r.after,
       `SMS hold ${msg.internal_id.slice(0, 8)} (${priceSource})`,
       `Reserved at submit · ${priceSource}`, r.currency],
    );
  }

  // margin snapshot for profitability (§23)
  let vendorCost: number | null = null;
  try {
    const vc = await pool.query(`SELECT internal_vendor_cost FROM routes WHERE id=$1`, [chosen.route_id]).catch(() => ({ rows: [] as never[] }));
    vendorCost = vc.rows[0]?.internal_vendor_cost != null ? Number(vc.rows[0].internal_vendor_cost) : null;
    if (vendorCost == null && chain[0]?.cost != null) vendorCost = Number(chain[0].cost);
  } catch { /* ignore */ }
  const margin = vendorCost != null && clientPrice != null ? +(Number(clientPrice) - vendorCost * segments).toFixed(6) : null;

  await pool.query(
    'UPDATE messages SET route_id=$1, country_id=$2, client_price=$3, segments=$4, reserved_amount=$5, reserved_credits=$6, billing_mode=$7, billing_status=$8, dlr_cutting_selected=$9, dlr_cutting_config_id=$10, dlr_cutting_delay_seconds=$11 WHERE id=$12',
    [isUuid ? chosen.route_id : null, countryId, clientPrice, segments, reserveAmount, reserveCredits,
     billingMode, submitBilled ? 'submitted' : 'awaiting_delivery', cuttingSelected, cuttingConfigId, cuttingDelaySec, msg.internal_id],
  );
  await recordEvent(
    msg.internal_id, chain[0]?.vendor_id ?? null, 'routed',
    reserveCredits > 0
      ? `${chosen.route_name} [${chain.map((v) => v.vendor_name).join(' → ')}] · hold ${reserveCredits} credit(s)`
      : `${chosen.route_name} [${chain.map((v) => v.vendor_name).join(' → ')}] · hold ${reserveAmount} (${priceSource})`,
  );
  // routing log (best-effort, never block send)
  try {
    await pool.query(
      `INSERT INTO routing_logs (message_id, client_id, route_id, route_code, country_id, destination, source, channel, strategy, traffic_mode, vendor_chain, selected_vendor_id, selected_vendor_name, price_per_segment, vendor_cost, margin, routing_rule_id)
       VALUES ($1,$2,$3,(SELECT route_code FROM routes WHERE id=$3),$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)`,
      [msg.internal_id, msg.client_id, isUuid ? chosen.route_id : null, countryId, msg.destination, msg.source, msg.channel,
       chosen.strategy, (await pool.query(`SELECT traffic_mode FROM routes WHERE id=$1`, [chosen.route_id]).catch(() => ({ rows: [{ traffic_mode: chosen.strategy }] }))).rows[0]?.traffic_mode ?? chosen.strategy,
       JSON.stringify(chain.map((v) => ({ id: v.vendor_id, name: v.vendor_name, priority: v.priority, weight: v.weight }))),
       chain[0]?.vendor_id ?? null, chain[0]?.vendor_name ?? null,
       clientPrice != null ? Number(clientPrice) / segments : null, vendorCost, margin, activeRuleId],
    );
  } catch { /* table may not exist yet */ }

  await getQueue(QUEUES.vendorSend).add('send', {
    ...msg,
    route_id: isUuid ? chosen.route_id : null,
    country_id: countryId,
    vendor_chain: chain.map((v) => v.vendor_id),
    vendor_index: 0,
    client_price: clientPrice,
    billing_mode: billingMode,
    delivery_rate: deliveryRate,
  });
  await incrStat('routed');
}

async function main(): Promise<void> {
  const fastConc = Number(process.env.ROUTING_FAST_CONCURRENCY ?? process.env.ROUTING_WORKER_CONCURRENCY ?? 60);
  const bulkConc = Number(process.env.ROUTING_BULK_CONCURRENCY ?? 40);
  const perBulkConc = Math.max(4, Math.min(12, Math.floor(bulkConc / 2) || 8));
  createWorker(QUEUES.submit, handleJob, fastConc);
  // Bulk dispatcher: one dedicated queue per client (sms-submit-bulk:<clientId>)
  // so 5 clients each sending 10k to different vendors never block each other.
  // We keep pooled workers capped: total bulk concurrency stays near bulkConc
  // by giving each active client a small fair share and rebalancing on churn.
  const { getRedis, bulkQueueName, getBulkQueue } = await import('@8xtel/core');
  const bulkWorkers = new Map<string, ReturnType<typeof createWorker>>();
  // Fallback shared bulk queue for jobs that arrived before sharding
  createWorker(QUEUES.submitBulk, handleJob, Math.max(4, perBulkConc));
  async function ensureBulkWorker(clientId: string): Promise<void> {
    if (bulkWorkers.has(clientId)) return;
    const qName = bulkQueueName(clientId);
    bulkWorkers.set(clientId, createWorker(qName as never, handleJob, perBulkConc));
    console.log(`[routing-worker] bulk lane up for client ${clientId.slice(0,8)} (${qName} x${perBulkConc})`);
  }
  // Discover active bulk clients from Redis set 'bulk:clients' (populated
  // by portal/client-api/smpp-session on every bulk enqueue). Also eagerly
  // seed from any existing client IDs we already know.
  async function scanBulkClients(): Promise<void> {
    try {
      const redis = getRedis();
      const ids = await redis.smembers('bulk:clients');
      for (const id of ids) await ensureBulkWorker(id);
      // Also scan Queue keys that exist even if set was cleared (reconnect)
      // lightweight: only if no ids found, do a KEYS scan once per minute
    } catch {}
  }
  await scanBulkClients();
  setInterval(scanBulkClients, 3000).unref();
  // Subscribe to new bulk clients via Redis keyspace notifier is overkill;
  // the 3s poll is enough for <5s first-message latency. For even faster
  // reaction, also watch for BRPOP-style hint key.
  try {
    const sub = getRedis().duplicate();
    // Use a tiny pub/sub hint: producers publish to 'bulk:hint' (<20b)
    // best-effort, no need for persistence.
    await sub.subscribe('bulk:hint');
    sub.on('message', (_ch: string, cid: string) => { if (cid) void ensureBulkWorker(cid.trim()); });
  } catch {}
  // auto health protection: every 60s mark OPEN when submit<90% or timeout>5%, cooldown 5m
  setInterval(async () => {
    try {
      const pool = getPool();
      const rows = await pool.query(`SELECT route_id, vendor_id, circuit_state FROM route_health WHERE circuit_state IN ('HEALTHY','DEGRADED')`).then((r) => r.rows as Array<{ route_id: string; vendor_id: string; circuit_state: string }>).catch(() => []);
      for (const h of rows) {
        const s = await pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE m.status='delivered') AS ok FROM routing_logs l LEFT JOIN messages m ON m.id=l.message_id WHERE l.route_id=$1 AND l.selected_vendor_id=$2 AND l.created_at > now() - interval '10 minutes'`, [h.route_id, h.vendor_id]).then((r) => r.rows[0] as { total: string; ok: string }).catch(() => null);
        const total = Number(s?.total ?? 0); if (total < 20) continue;
        const pct = Number(s?.ok ?? 0) / total * 100;
        if (pct < 90) {
          await pool.query(`UPDATE route_health SET circuit_state='OPEN', opened_at=now(), recover_at=now() + interval '5 minutes', updated_at=now() WHERE route_id=$1 AND vendor_id=$2`, [h.route_id, h.vendor_id]);
        }
      }
      // recover OPEN whose cooldown expired → RECOVERING
      await pool.query(`UPDATE route_health SET circuit_state='RECOVERING', updated_at=now() WHERE circuit_state='OPEN' AND recover_at IS NOT NULL AND recover_at <= now()`).catch(() => undefined);
    } catch { /* ignore */ }
  }, 60_000).unref();
  console.log(`[8xtelSMPP routing-worker] started fast=${fastConc} bulk=${bulkConc} (submit=${QUEUES.submit} bulk=${QUEUES.submitBulk})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
