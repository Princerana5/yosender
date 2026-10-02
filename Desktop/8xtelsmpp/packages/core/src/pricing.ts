// ── Central pricing & profitability — decimal-safe, multi-currency (§1-§28) ─
import { query, queryOne, getPool } from './db.js';

export type PricingMode = 'direct' | 'percent_markup' | 'fixed_markup';

/** Decimal-safe rate calc. Never float for money — string in, string out. */
export function calcSellingRate(args: {
  vendorCost: string | number;
  pricingMode: PricingMode;
  markupValue?: string | number | null;
  directRate?: string | number | null;
}): string {
  if (args.pricingMode === 'direct') return String(args.directRate ?? args.vendorCost);
  const cost = Number(args.vendorCost);
  const m = Number(args.markupValue ?? 0);
  if (args.pricingMode === 'percent_markup') return (cost * (1 + m / 100)).toFixed(6).replace(/\.?0+$/, '') || '0';
  return (cost + m).toFixed(6).replace(/\.?0+$/, '') || '0'; // fixed_markup
}

export function marginPerSegment(selling: string | number, vendorCost: string | number): string {
  return (Number(selling) - Number(vendorCost)).toFixed(6).replace(/\.?0+$/, '') || '0';
}
export function marginPct(selling: string | number, vendorCost: string | number): number {
  const c = Number(vendorCost);
  if (!c) return 0;
  return +(((Number(selling) - c) / c) * 100).toFixed(2);
}

/** Revenue = billable traffic × selling rate (billing_mode aware). */
export function billableFilter(billingModeCol = 'm.billing_mode', statusCol = 'm.status'): string {
  // Billable = submitted always; delivered additionally when mode bills on delivery
  // For profitability aggregates we count by billing_status/billing_records instead.
  void billingModeCol; void statusCol;
  return `m.billing_status IN ('billed','submitted')`;
}

// ── Resolve selling price for one message (priority chain) ─────────────────
export async function resolveSellingPrice(opts: {
  routeId: string | null;
  clientId: string;
  countryId: string | null;
  mcc?: string | null;
  mnc?: string | null;
  segments?: number;
}): Promise<{ pricePerSegment: string | null; currency: string; source: string }> {
  const segs = opts.segments ?? 1;
  // 1) route_client_rates exact (route+client+country/mcc/mnc)
  if (opts.routeId) {
    const r = await queryOne<{ price_per_segment: string; currency: string }>(
      `SELECT price_per_segment, currency FROM route_client_rates
       WHERE route_id=$1 AND client_id=$2
         AND (country_id IS NULL OR country_id=$3)
         AND (mcc IS NULL OR mcc=$4 OR mcc='')
         AND (mnc IS NULL OR mnc=$5 OR mnc='')
       ORDER BY country_id NULLS LAST, mcc NULLS LAST, mnc NULLS LAST LIMIT 1`,
      [opts.routeId, opts.clientId, opts.countryId, opts.mcc ?? null, opts.mnc ?? null],
    );
    if (r) return { pricePerSegment: String(Number(r.price_per_segment) * segs), currency: r.currency, source: 'route_client_rates' };
    // 2) route default
    const rd = await queryOne<{ price_per_segment: string | null; price_currency: string }>(
      'SELECT price_per_segment, price_currency FROM routes WHERE id=$1', [opts.routeId],
    );
    if (rd?.price_per_segment != null) return { pricePerSegment: String(Number(rd.price_per_segment) * segs), currency: rd.price_currency ?? 'EUR', source: 'route' };
  }
  // 3) client_rates longest prefix fallback
  return { pricePerSegment: null, currency: 'EUR', source: 'none' };
}

// ── Profitability aggregations (no full scan — uses indexes) ───────────────
export interface ProfitRow {
  key: string; label: string;
  messages: number; billable: number;
  revenue: number; vendorCost: number; margin: number; marginPct: number;
  currency: string;
}

export async function profitabilityByRoute(opts: {
  from?: string; to?: string; currency?: string; clientId?: string; vendorId?: string; countryId?: string;
}): Promise<ProfitRow[]> {
  const conds: string[] = [`m.created_at >= COALESCE($1::date, now() - interval '30 days')`, `m.created_at < COALESCE($2::date, now()) + interval '1 day'`];
  const params: unknown[] = [opts.from ?? null, opts.to ?? null];
  let pi = params.length;
  if (opts.currency) { conds.push(`COALESCE(m.price_currency, r.currency, 'EUR') = $${++pi}`); params.push(opts.currency); }
  if (opts.clientId) { conds.push(`m.client_id = $${++pi}::uuid`); params.push(opts.clientId); }
  if (opts.countryId) { conds.push(`m.country_id = $${++pi}::uuid`); params.push(opts.countryId); }
  const where = conds.join(' AND ');
  // Revenue from billing_records when available, else client_price on messages; vendor cost from vendor_rates snapshot or routes.internal_vendor_cost
  const rows = await query<{
    route_id: string; route_code: string | null; route_name: string;
    messages: string; billable: string; revenue: string; vendor_cost: string;
  }>(
    `SELECT r.id AS route_id, r.route_code, r.name AS route_name,
            COUNT(*) AS messages,
            COUNT(*) FILTER (WHERE m.billing_status IN ('billed','submitted','awaiting_delivery')) AS billable,
            COALESCE(SUM(CASE WHEN br.client_price IS NOT NULL THEN br.client_price ELSE COALESCE(m.client_price,0) END),0) AS revenue,
            COALESCE(SUM(COALESCE(br.vendor_cost, m.vendor_cost, r.internal_vendor_cost, 0)),0) AS vendor_cost
     FROM messages m
     JOIN routes r ON r.id=m.route_id
     LEFT JOIN billing_records br ON br.message_id=m.id
     WHERE ${where}
     GROUP BY r.id, r.route_code, r.name
     ORDER BY revenue DESC`,
    params,
  );
  return rows.map((r) => {
    const rev = Number(r.revenue); const cost = Number(r.vendor_cost); const marg = rev - cost;
    return { key: r.route_id, label: r.route_code ?? r.route_name, messages: Number(r.messages), billable: Number(r.billable), revenue: rev, vendorCost: cost, margin: marg, marginPct: rev ? +(marg / rev * 100).toFixed(2) : 0, currency: opts.currency ?? 'EUR' };
  });
}

export async function profitabilityByClient(opts: { from?: string; to?: string; currency?: string; routeId?: string; countryId?: string }): Promise<ProfitRow[]> {
  const conds: string[] = [`m.created_at >= COALESCE($1::date, now() - interval '30 days')`, `m.created_at < COALESCE($2::date, now()) + interval '1 day'`];
  const params: unknown[] = [opts.from ?? null, opts.to ?? null];
  let pi = params.length;
  if (opts.currency) { conds.push(`COALESCE(m.price_currency,'EUR')=$${++pi}`); params.push(opts.currency); }
  if (opts.routeId) { conds.push(`m.route_id=$${++pi}::uuid`); params.push(opts.routeId); }
  if (opts.countryId) { conds.push(`m.country_id=$${++pi}::uuid`); params.push(opts.countryId); }
  const where = conds.join(' AND ');
  const rows = await query<{
    client_id: string; client_name: string; messages: string; billable: string; revenue: string; vendor_cost: string;
  }>(
    `SELECT c.id AS client_id, c.name AS client_name,
            COUNT(*) AS messages,
            COUNT(*) FILTER (WHERE m.billing_status IN ('billed','submitted','awaiting_delivery')) AS billable,
            COALESCE(SUM(COALESCE(br.client_price, m.client_price, 0)),0) AS revenue,
            COALESCE(SUM(COALESCE(br.vendor_cost, m.vendor_cost, 0)),0) AS vendor_cost
     FROM messages m JOIN clients c ON c.id=m.client_id
     LEFT JOIN billing_records br ON br.message_id=m.id
     WHERE ${where}
     GROUP BY c.id, c.name ORDER BY revenue DESC`,
    params,
  );
  return rows.map((r) => {
    const rev = Number(r.revenue); const cost = Number(r.vendor_cost); const marg = rev - cost;
    return { key: r.client_id, label: r.client_name, messages: Number(r.messages), billable: Number(r.billable), revenue: rev, vendorCost: cost, margin: marg, marginPct: rev ? +(marg / rev * 100).toFixed(2) : 0, currency: opts.currency ?? 'EUR' };
  });
}

export async function profitabilityByCountry(opts: { from?: string; to?: string; currency?: string }): Promise<ProfitRow[]> {
  const rows = await query<{
    country_id: string | null; country_name: string; iso_code: string | null;
    messages: string; billable: string; revenue: string; vendor_cost: string;
  }>(
    `SELECT co.id AS country_id, COALESCE(co.name,'Unknown') AS country_name, co.iso_code,
            COUNT(*) AS messages,
            COUNT(*) FILTER (WHERE m.billing_status IN ('billed','submitted','awaiting_delivery')) AS billable,
            COALESCE(SUM(COALESCE(br.client_price, m.client_price,0)),0) AS revenue,
            COALESCE(SUM(COALESCE(br.vendor_cost, m.vendor_cost,0)),0) AS vendor_cost
     FROM messages m LEFT JOIN countries co ON co.id=m.country_id
     LEFT JOIN billing_records br ON br.message_id=m.id
     WHERE m.created_at >= COALESCE($1::date, now() - interval '30 days')
       AND m.created_at < COALESCE($2::date, now()) + interval '1 day'
       AND ($3::text IS NULL OR COALESCE(m.price_currency,'EUR')=$3)
     GROUP BY co.id, co.name, co.iso_code ORDER BY revenue DESC`,
    [opts.from ?? null, opts.to ?? null, opts.currency ?? null],
  );
  return rows.map((r) => {
    const rev = Number(r.revenue); const cost = Number(r.vendor_cost); const marg = rev - cost;
    return { key: r.country_id ?? 'unknown', label: r.country_name + (r.iso_code ? ` (${r.iso_code})` : ''), messages: Number(r.messages), billable: Number(r.billable), revenue: rev, vendorCost: cost, margin: marg, marginPct: rev ? +(marg / rev * 100).toFixed(2) : 0, currency: opts.currency ?? 'EUR' };
  });
}

export async function dashboardFinancials(opts: { from?: string; to?: string; currency?: string }): Promise<{ revenue: number; vendorCost: number; margin: number; marginPct: number; messages: number; billable: number; currency: string }> {
  const r = await queryOne<{ revenue: string; vendor_cost: string; messages: string; billable: string }>(
    `SELECT COALESCE(SUM(COALESCE(br.client_price, m.client_price,0)),0) AS revenue,
            COALESCE(SUM(COALESCE(br.vendor_cost, m.vendor_cost,0)),0) AS vendor_cost,
            COUNT(*) AS messages,
            COUNT(*) FILTER (WHERE m.billing_status IN ('billed','submitted','awaiting_delivery')) AS billable
     FROM messages m LEFT JOIN billing_records br ON br.message_id=m.id
     WHERE m.created_at >= COALESCE($1::date, now() - interval '30 days')
       AND m.created_at < COALESCE($2::date, now()) + interval '1 day'
       AND ($3::text IS NULL OR COALESCE(m.price_currency,'EUR')=$3)`,
    [opts.from ?? null, opts.to ?? null, opts.currency ?? null],
  );
  const rev = Number(r?.revenue ?? 0); const cost = Number(r?.vendor_cost ?? 0); const marg = rev - cost;
  return { revenue: rev, vendorCost: cost, margin: marg, marginPct: rev ? +(marg / rev * 100).toFixed(2) : 0, messages: Number(r?.messages ?? 0), billable: Number(r?.billable ?? 0), currency: opts.currency ?? 'EUR' };
}
