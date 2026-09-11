import {
  createWorker, getQueue, QUEUES, getPool, checkTps, incrStat, type MessageJob,
} from '@8xtel/core';
import { resolveCountry, applyFilters, findRoutes, orderVendors, recordEvent } from './engine.js';

// ── Routing worker: sms:submit → route → sms:vendor-send (§15, Phase 3) ──────
// Fails over across the ordered vendor chain at SEND time (vendor-worker
// re-queues with next index); here we attach the chain + pricing snapshot.

async function handleJob(job: { data: MessageJob }): Promise<void> {
  const msg = job.data;
  const pool = getPool();

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
  if (filter.action === 'reroute' && filter.reroute_id) {
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
    await pool.query(`UPDATE messages SET status='failed', error_description='no route' WHERE id=$1`, [msg.internal_id]);
    await recordEvent(msg.internal_id, null, 'failed', 'no route found');
    await incrStat('failed');
    return;
  }

  const chosen = candidates[0];
  const chain = await orderVendors(chosen);

  // Route TPS guard (§18) — requeue with delay instead of dropping
  const routeRow = await pool.query('SELECT tps_limit FROM routes WHERE id=$1', [chosen.route_id]);
  const routeTps: number | null = routeRow.rows[0]?.tps_limit ?? null;
  if (routeTps && !(await checkTps(`route:${chosen.route_id}`, routeTps))) {
    await getQueue(QUEUES.submit).add('submit', msg, { delay: 1000 });
    return;
  }

  // Client price snapshot (longest prefix, §13)
  const digits = msg.destination.replace(/\D/g, '');
  const priceRow = await pool.query(
    `SELECT cr.price FROM client_rates cr JOIN clients c ON c.pricing_profile_id=cr.profile_id
     WHERE c.id=$1 AND ($2 LIKE COALESCE(cr.prefix,'') || '%' OR cr.country_id=$3)
     ORDER BY length(COALESCE(cr.prefix,'')) DESC LIMIT 1`,
    [msg.client_id, digits, countryId],
  );
  const clientPrice = priceRow.rows[0]?.price ?? null;

  await pool.query(
    'UPDATE messages SET route_id=$1, country_id=$2, client_price=$3 WHERE id=$4',
    [chosen.route_id, countryId, clientPrice, msg.internal_id],
  );
  await recordEvent(
    msg.internal_id, chain[0]?.vendor_id ?? null, 'routed',
    `${chosen.route_name} [${chain.map((v) => v.vendor_name).join(' → ')}]`,
  );

  await getQueue(QUEUES.vendorSend).add('send', {
    ...msg,
    route_id: chosen.route_id,
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
