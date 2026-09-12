import {
  createWorker, getQueue, QUEUES, getPool, checkTps, tryAcquireTps, incrStat, analyzeSms, type MessageJob,
} from '@8xtel/core';
import { resolveCountry, applyFilters, findRoutes, orderVendors, recordEvent } from './engine.js';

// ── Routing worker: sms:submit → route → sms:vendor-send (§15, Phase 3) ──────
// Fails over across the ordered vendor chain at SEND time (vendor-worker
// re-queues with next index); here we attach the chain + pricing snapshot.

async function handleJob(job: { data: MessageJob }): Promise<void> {
  const msg = job.data;
  const pool = getPool();

  // Per-client TPS guard (§18) — delay + retry, never drop. This is what paces
  // bulk campaigns: 100k numbers queue instantly, drain at the client's rate.
  // Uses tryAcquireTps (non-filling): denied attempts leave no window entry,
  // so hundreds of retrying jobs can't saturate the window into deadlock.
  const clientRow = await pool.query(
    'SELECT tps_limit FROM clients WHERE id=$1', [msg.client_id],
  );
  const clientTps: number = Number(clientRow.rows[0]?.tps_limit ?? 0);
  if (clientTps > 0 && !(await tryAcquireTps(`client:${msg.client_id}`, clientTps))) {
    const jitter = 1000 + Math.floor(Math.random() * 2000);
    await getQueue(QUEUES.submit).add('submit', msg, { delay: jitter });
    return;
  }

  const country = await resolveCountry(msg.destination);
  const countryId = country?.id ?? null;

  const filter = await applyFilters(msg.client_id, msg.destination, msg.source, countryId);
  if (filter.action === 'block' || filter.action === 'reject') {
    await pool.query(`UPDATE messages SET status='rejected', error_description=$1 WHERE id=$2`, [
      `filtered:${filter.action}`, msg.internal_id,
    ]);
    await recordEvent(msg.internal_id, null, 'failed', `filter ${filter.action}`);
    await incrStat('rejected');
    return;
  }

  let candidates = await findRoutes(msg.client_id, msg.channel, countryId, msg.destination, msg.source);
  // Test override (Send Test SMS page): force a route, optionally a single vendor.
  // Skips route matching AND reroute filters; block/reject filters above still apply.
  const forceRouteId = msg.force_route_id ?? null;
  const forceVendorId = msg.force_vendor_id ?? null;
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

  // Route TPS guard (§18) — requeue with delay instead of dropping
  const routeRow = isUuid
    ? await pool.query('SELECT tps_limit FROM routes WHERE id=$1', [chosen.route_id])
    : { rows: [] as Array<{ tps_limit: number | null }> };
  const routeTps: number | null = routeRow.rows[0]?.tps_limit ?? null;
  if (routeTps && !(await checkTps(`route:${chosen.route_id}`, routeTps))) {
    await getQueue(QUEUES.submit).add('submit', msg, { delay: 1000 });
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
    const rp = await pool.query(
      'SELECT price_per_segment FROM routes WHERE id=$1', [chosen.route_id],
    );
    const pp = rp.rows[0]?.price_per_segment;
    if (pp !== null && pp !== undefined) {
      clientPrice = String(Number(pp) * segments);
      priceSource = `route:${chosen.route_name} × ${segments}seg`;
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
  const reserveAmount = Number(clientPrice ?? 0);

  // ── Submit-time reservation: hold funds NOW, settle on outcome (§28) ──────
  // Atomic: only proceed if wallet covers the hold (prepay floor 0,
  // postpay floor -credit_limit). Concurrent submits serialize on the row lock.
  if (reserveAmount > 0) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const w = await db.query(
        'SELECT balance, credit_limit, billing_mode, currency FROM wallets WHERE client_id=$1 FOR UPDATE',
        [msg.client_id],
      );
      if (!w.rowCount) {
        await db.query('ROLLBACK');
        await pool.query(`UPDATE messages SET status='failed', error_description='no wallet', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
        await recordEvent(msg.internal_id, null, 'failed', 'no wallet for reservation');
        await incrStat('failed');
        return;
      }
      const wallet = w.rows[0] as { balance: string; credit_limit: string; billing_mode: string; currency: string };
      const after = Number(wallet.balance) - reserveAmount;
      const floor = wallet.billing_mode === 'postpay' ? -Number(wallet.credit_limit) : 0;
      if (after < floor) {
        await db.query('ROLLBACK');
        await pool.query(`UPDATE messages SET status='rejected', error_description='insufficient balance at routing', country_id=$1 WHERE id=$2`, [countryId, msg.internal_id]);
        await recordEvent(msg.internal_id, null, 'failed', `reservation failed: need ${reserveAmount}, floor ${floor}`);
        await incrStat('rejected');
        return;
      }
      await db.query('UPDATE wallets SET balance=$1, updated_at=now() WHERE client_id=$2', [after, msg.client_id]);
      await db.query('UPDATE clients SET balance=$1 WHERE id=$2', [after, msg.client_id]);
      await db.query(
        `INSERT INTO transactions (client_id, message_id, type, amount, balance_after, description, remark, currency)
         VALUES ($1,$2,'debit',$3,$4,$5,$6,$7)`,
        [msg.client_id, msg.internal_id, -reserveAmount, after,
         `SMS hold ${msg.internal_id.slice(0, 8)} (${priceSource})`,
         `Reserved at submit · ${priceSource}`, wallet.currency],
      );
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      db.release();
    }
  }

  await pool.query(
    'UPDATE messages SET route_id=$1, country_id=$2, client_price=$3, segments=$4, reserved_amount=$5 WHERE id=$6',
    [isUuid ? chosen.route_id : null, countryId, clientPrice, segments, reserveAmount, msg.internal_id],
  );
  await recordEvent(
    msg.internal_id, chain[0]?.vendor_id ?? null, 'routed',
    `${chosen.route_name} [${chain.map((v) => v.vendor_name).join(' → ')}] · hold ${reserveAmount} (${priceSource})`,
  );

  await getQueue(QUEUES.vendorSend).add('send', {
    ...msg,
    route_id: isUuid ? chosen.route_id : null,
    country_id: countryId,
    vendor_chain: chain.map((v) => v.vendor_id),
    vendor_index: 0,
    client_price: clientPrice,
  });
  await incrStat('routed');
}

async function main(): Promise<void> {
  createWorker(QUEUES.submit, handleJob, 20);
  console.log('[8xtelSMPP routing-worker] started');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
