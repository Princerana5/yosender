import { query, queryOne, getPool, getRedis } from '@8xtel/core';

// ── Route engine (§10–§12, §18–§20, §24) ─────────────────────────────────────
// 1. resolve country by longest prefix → 2. filters (allow/block/reroute) →
// 3. candidate routes (client-specific → global, longest prefix wins) →
// 4. strategy: priority | failover | round_robin | least_cost | percentage →
// 5. ordered vendor list for failover chain.

export interface RouteCandidate {
  route_id: string;
  route_name: string;
  strategy: string;
  vendors: Array<{ vendor_id: string; vendor_name: string; priority: number; weight: number; cost: string | null; tps: number }>;
}

export async function resolveCountry(destination: string): Promise<{ id: string; name: string; iso: string } | null> {
  const digits = destination.replace(/\D/g, '');
  // Longest-prefix match against prefixes, fallback to calling code
  const hit = await queryOne<{ id: string; name: string; iso_code: string }>(
    `SELECT c.id, c.name, c.iso_code FROM prefixes p JOIN countries c ON c.id=p.country_id
     WHERE $1 LIKE p.prefix || '%' AND c.status='active'
     ORDER BY length(p.prefix) DESC LIMIT 1`,
    [digits],
  );
  if (hit) return { id: hit.id, name: hit.name, iso: hit.iso_code };
  const cc = await queryOne<{ id: string; name: string; iso_code: string }>(
    `SELECT id, name, iso_code FROM countries WHERE $1 LIKE calling_code || '%' AND status='active'
     ORDER BY length(calling_code) DESC LIMIT 1`,
    [digits],
  );
  return cc ? { id: cc.id, name: cc.name, iso: cc.iso_code } : null;
}

export async function applyFilters(
  clientId: string,
  destination: string,
  source: string,
  countryId: string | null,
): Promise<{ action: string; reroute_id?: string }> {
  const filters = await query<{
    action: string; reroute_id: string | null; match_prefix: string | null;
    match_sender: string | null; match_country_id: string | null;
  }>(
    `SELECT action, reroute_id, match_prefix, match_sender, match_country_id FROM filters
     WHERE enabled=true AND (client_id IS NULL OR client_id=$1) ORDER BY priority`,
    [clientId],
  );
  for (const f of filters) {
    if (f.match_country_id && f.match_country_id !== countryId) continue;
    if (f.match_prefix && !destination.replace(/\D/g, '').startsWith(f.match_prefix)) continue;
    if (f.match_sender && f.match_sender !== source) continue;
    return { action: f.action, reroute_id: f.reroute_id ?? undefined };
  }
  return { action: 'allow' };
}

export async function findRoutes(
  clientId: string,
  channel: string,
  countryId: string | null,
  destination: string,
  source: string,
): Promise<RouteCandidate[]> {
  const digits = destination.replace(/\D/g, '');
  const rows = await query<{
    route_id: string; route_name: string; strategy: string;
    vendor_id: string; vendor_name: string; priority: number; weight: number;
    cost: string | null; tps: number;
  }>(
    `SELECT r.id AS route_id, r.name AS route_name, r.strategy,
            v.id AS vendor_id, v.name AS vendor_name, rv.priority, rv.weight,
            (SELECT cost FROM vendor_rates vr WHERE vr.vendor_id=v.id
               AND ($1 LIKE COALESCE(vr.prefix,'') || '%' OR vr.country_id=$2)
             ORDER BY length(COALESCE(vr.prefix,'')) DESC LIMIT 1) AS cost,
            v.tps
     FROM routes r
     JOIN route_vendors rv ON rv.route_id=r.id
     JOIN vendors v ON v.id=rv.vendor_id AND v.status='enabled'
     WHERE r.status='active' AND r.channel=$3
       AND (r.client_id IS NULL OR r.client_id=$4)
       AND (r.country_id IS NULL OR r.country_id=$2)
       AND (r.prefix IS NULL OR $1 LIKE r.prefix || '%')
       AND (r.sender_id IS NULL OR r.sender_id=$5)
     ORDER BY (r.client_id IS NULL), length(COALESCE(r.prefix,'')) DESC, rv.priority`,
    [digits, countryId, channel, clientId, source],
  );
  const map = new Map<string, RouteCandidate>();
  for (const r of rows) {
    let c = map.get(r.route_id);
    if (!c) {
      c = { route_id: r.route_id, route_name: r.route_name, strategy: r.strategy, vendors: [] };
      map.set(r.route_id, c);
    }
    c.vendors.push({
      vendor_id: r.vendor_id, vendor_name: r.vendor_name, priority: r.priority,
      weight: r.weight, cost: r.cost, tps: r.tps,
    });
  }
  return [...map.values()];
}

/** Order vendors per strategy. Returns full chain for failover (§11). */
export async function orderVendors(
  candidate: RouteCandidate,
): Promise<RouteCandidate['vendors']> {
  const vendors = [...candidate.vendors];
  switch (candidate.strategy) {
    case 'least_cost':
      return vendors.sort((a, b) => Number(a.cost ?? Infinity) - Number(b.cost ?? Infinity));
    case 'round_robin': {
      const redis = getRedis();
      const idx = Number(await redis.incr(`rr:${candidate.route_id}`));
      const n = vendors.sort((a, b) => a.priority - b.priority);
      const k = idx % n.length;
      return [...n.slice(k), ...n.slice(0, k)];
    }
    case 'percentage': {
      // Weighted shuffle — one roll, full chain preserved behind the pick
      const total = vendors.reduce((s, v) => s + v.weight, 0) || 1;
      let roll = Math.random() * total;
      let first = vendors[0];
      for (const v of vendors) {
        roll -= v.weight;
        if (roll <= 0) {
          first = v;
          break;
        }
      }
      return [first, ...vendors.filter((v) => v !== first)];
    }
    case 'priority':
    case 'failover':
    default:
      return vendors.sort((a, b) => a.priority - b.priority);
  }
}

export async function recordEvent(messageId: string, vendorId: string | null, event: string, detail?: string): Promise<void> {
  await getPool().query(
    'INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,$3,$4)',
    [messageId, vendorId, event, detail ?? null],
  );
}
