import { query, queryOne, getPool, getRedis, classifyNanp } from '@8xtel/core';

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
  // NANP (+1) is shared by USA, Canada and ~20 other territories — the NPA
  // (area code) decides, never the bare '1'. Resolve the ISO from the NPA
  // table so +1212 → US and +1416 → CA instead of whichever country row
  // (Canada, calling_code '1') the generic fallback happens to match first.
  if (digits.startsWith('1') && (digits.length === 11 || digits.length === 10)) {
    const nanp = classifyNanp(digits);
    const iso = nanp === 'US' ? 'US' : nanp === 'CA' ? 'CA' : null;
    if (iso) {
      const row = await queryOne<{ id: string; name: string; iso_code: string }>(
        `SELECT id, name, iso_code FROM countries WHERE iso_code=$1 AND status='active'`,
        [iso],
      );
      if (row) return { id: row.id, name: row.name, iso: row.iso_code };
    }
    return null; // unassigned NPA / other territory — never guess Canada
  }
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
       AND (
         -- global: no membership rows → serves everyone
         NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id)
         -- member: this client explicitly listed
         OR EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id AND rc.client_id=$4)
       )
       AND NOT EXISTS (
         SELECT 1 FROM route_client_exclusions x
         WHERE x.route_id=r.id AND x.client_id=$4
       )
       AND (r.country_id IS NULL OR r.country_id=$2)
       AND (r.prefix IS NULL OR $1 LIKE r.prefix || '%')
       AND (r.sender_id IS NULL OR r.sender_id=$5)
     ORDER BY (NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id)), length(COALESCE(r.prefix,'')) DESC, rv.priority`,
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

/** Resolve active routing rule for extra dimensions (MCC/MNC/sender/type/source/time). */
export async function resolveRoutingRule(opts: {
  countryId: string | null; mcc?: string | null; mnc?: string | null;
  sender?: string; messageType?: string; sourceType?: string;
}): Promise<{ id: string; route_id: string | null; route_group_id: string | null; traffic_mode: string } | null> {
  try {
    const rows = await query<{
      id: string; route_id: string | null; route_group_id: string | null; traffic_mode: string;
      country_id: string | null; mcc: string | null; mnc: string | null; sender_id: string | null;
      message_type: string | null; source_type: string | null; time_from: string | null; time_to: string | null;
    }>(`SELECT id, route_id, route_group_id, traffic_mode, country_id, mcc, mnc, sender_id, message_type, source_type, time_from, time_to
        FROM routing_rules WHERE enabled=true ORDER BY priority ASC, created_at ASC LIMIT 100`);
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    for (const r of rows) {
      if (r.country_id && r.country_id !== opts.countryId) continue;
      if (r.mcc && r.mcc !== opts.mcc) continue;
      if (r.mnc && r.mnc !== opts.mnc) continue;
      if (r.sender_id && r.sender_id !== opts.sender) continue;
      if (r.message_type && r.message_type !== 'any' && r.message_type !== opts.messageType) continue;
      if (r.source_type && r.source_type !== 'any' && r.source_type !== opts.sourceType) continue;
      if (r.time_from && r.time_to) {
        const [fh, fm] = r.time_from.split(':').map(Number);
        const [th, tm] = r.time_to.split(':').map(Number);
        const fromMin = (fh ?? 0) * 60 + (fm ?? 0);
        const toMin = (th ?? 0) * 60 + (tm ?? 0);
        const inWindow = fromMin <= toMin ? (curMin >= fromMin && curMin <= toMin) : (curMin >= fromMin || curMin <= toMin);
        if (!inWindow) continue;
      }
      return { id: r.id, route_id: r.route_id, route_group_id: r.route_group_id, traffic_mode: r.traffic_mode ?? 'priority' };
    }
  } catch { /* tables may not exist yet */ }
  return null;
}

/** Health-aware filter: drop OPEN vendors, deprioritize DEGRADED. */
async function filterByHealth(routeId: string, vendors: RouteCandidate['vendors']): Promise<RouteCandidate['vendors']> {
  try {
    const rows = await query<{ vendor_id: string; circuit_state: string; recover_at: string | null }>(
      `SELECT vendor_id, circuit_state, recover_at FROM route_health WHERE route_id=$1`, [routeId],
    );
    const state = new Map(rows.map((r) => [r.vendor_id, r]));
    const now = Date.now();
    return vendors.filter((v) => {
      const h = state.get(v.vendor_id);
      if (!h) return true;
      if (h.circuit_state === 'OPEN') {
        if (h.recover_at && new Date(h.recover_at).getTime() <= now) return true; // recovering
        return false;
      }
      return true;
    }).sort((a, b) => {
      const sa = state.get(a.vendor_id)?.circuit_state ?? 'HEALTHY';
      const sb = state.get(b.vendor_id)?.circuit_state ?? 'HEALTHY';
      const rank = (s: string) => s === 'HEALTHY' ? 0 : s === 'RECOVERING' ? 1 : s === 'DEGRADED' ? 2 : 3;
      return rank(sa) - rank(sb) || a.priority - b.priority;
    });
  } catch { return vendors; }
}

/** Order vendors per strategy. Returns full chain for failover (§11). */
export async function orderVendors(
  candidate: RouteCandidate,
): Promise<RouteCandidate['vendors']> {
  let vendors = [...candidate.vendors];
  // health filter first
  vendors = await filterByHealth(candidate.route_id, vendors);
  if (!vendors.length) vendors = [...candidate.vendors]; // fallback: all if health wiped out

  // traffic_mode override (new) falls back to strategy (legacy)
  const modeRow = await queryOne<{ traffic_mode: string }>(`SELECT traffic_mode FROM routes WHERE id=$1`, [candidate.route_id]).catch(() => null);
  const mode = modeRow?.traffic_mode ?? candidate.strategy;

  switch (mode) {
    case 'least_cost':
    case 'best_quality': {
      // least_cost with quality gate: exclude economy if direct/premium available
      const qualityRank: Record<string, number> = { direct: 0, premium: 1, standard: 2, economy: 3, custom: 4 };
      if (mode === 'least_cost') {
        // quality gate: require at least standard if direct/premium exists
        vendors = vendors.filter((v) => {
          const q = (v as unknown as { quality?: string }).quality ?? 'standard';
          return qualityRank[q] !== undefined;
        });
      }
      if (mode === 'best_quality') {
        return vendors.sort((a, b) => {
          const qa = qualityRank[(a as unknown as { quality?: string }).quality ?? 'standard'] ?? 2;
          const qb = qualityRank[(b as unknown as { quality?: string }).quality ?? 'standard'] ?? 2;
          return qa - qb || Number(a.cost ?? Infinity) - Number(b.cost ?? Infinity);
        });
      }
      return vendors.sort((a, b) => Number(a.cost ?? Infinity) - Number(b.cost ?? Infinity));
    }
    case 'round_robin': {
      const redis = getRedis();
      const idx = Number(await redis.incr(`rr:${candidate.route_id}`));
      const n = vendors.sort((a, b) => a.priority - b.priority);
      const k = idx % n.length;
      return [...n.slice(k), ...n.slice(0, k)];
    }
    case 'weighted':
    case 'percentage': {
      // Smooth weighted (WRR): spreads 80/20 as 8/2 per 10, not 80 straight
      // then 20. Built from deficit round-robin ring sampled by atomic counter.
      const total = vendors.reduce((s, v) => s + v.weight, 0) || 1;
      const ordered = [...vendors].sort((a, b) => a.priority - b.priority || a.vendor_id.localeCompare(b.vendor_id));
      // Build ring deterministically — deficits method gives even spread
      const ring: typeof ordered = [];
      const deficit = ordered.map(() => 0);
      for (let i = 0; i < total; i++) {
        for (let j = 0; j < ordered.length; j++) deficit[j] += ordered[j].weight;
        let best = 0;
        for (let j = 1; j < deficit.length; j++) if (deficit[j] > deficit[best]) best = j;
        ring.push(ordered[best]);
        deficit[best] -= total;
      }
      let ctr = 0;
      try {
        const redis = getRedis();
        ctr = Number(await redis.incr(`wdist:${candidate.route_id}`));
        if (ctr > 10_000_000) await redis.set(`wdist:${candidate.route_id}`, String(ctr % total));
      } catch {
        ctr = Math.floor(Math.random() * total) + 1;
      }
      const idx = ((ctr - 1) % total + total) % total;
      const first = ring[idx] ?? ordered[0];
      return [first, ...ordered.filter((v) => v.vendor_id !== first.vendor_id)];
    }
    case 'priority':
    case 'failover':
    case 'failover_only':
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
