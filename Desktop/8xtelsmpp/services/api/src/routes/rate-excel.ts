import ExcelJS from 'exceljs';
import { query, queryOne } from '@8xtel/core';

export interface ClientRateRow {
  country: string;
  operator: string;
  mcc: string;
  mnc: string;
  rate: number;
  currency: string;
  time: string;
}

export const RN_HEADER_ROW = 8;
export const RN_COLUMNS = ['Country', 'Operator (All)', 'MCC', 'MNC', 'Rate', 'Currency', 'Time'];

function fmtDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

export interface ClientRateList {
  rows: ClientRateRow[];
  currency: string;
  countries: number;
  networks: number;
}

// ── The client's COMPLETE current active rate list ──────────────────────────
// Scoped strictly to this client: member routes + global fallback, minus
// per-client exclusions, sms only, active status. Mirrors the routing
// engine's candidate set (same predicates as clients.ts detail + portal.ts).
// Price priority per route: route_client_rates → route.price_per_segment → client_rates longest
// prefix match → skipped (no price = not billable = not listed).
export async function getClientActiveRates(clientId: string, validFrom: Date = new Date()): Promise<ClientRateList> {
  const client = await queryOne<{ name: string; company_name: string | null; system_id: string; currency: string; pricing_profile_id: string | null }>(
    'SELECT name, company_name, system_id, COALESCE(currency,\'EUR\') AS currency, pricing_profile_id FROM clients WHERE id=$1',
    [clientId],
  );
  if (!client) throw new Error('client not found');
  const routes = await query<{
    id: string; name: string; prefix: string | null; price_per_segment: string | null;
    price_currency: string | null; country_name: string | null; iso_code: string | null;
    calling_code: string | null; rcr_price: string | null; rcr_currency: string | null;
  }>(
    `SELECT r.id, r.name, r.prefix, r.price_per_segment,
            COALESCE(r.price_currency,'EUR') AS price_currency,
            co.name AS country_name, co.iso_code, co.calling_code,
            rcr.price_per_segment AS rcr_price,
            rcr.currency AS rcr_currency
     FROM routes r LEFT JOIN countries co ON co.id=r.country_id
     LEFT JOIN route_client_rates rcr ON rcr.route_id=r.id AND rcr.client_id=$1
     WHERE r.status='active' AND r.channel='sms'
       AND (
         NOT EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id)
         OR EXISTS (SELECT 1 FROM route_clients rc WHERE rc.route_id=r.id AND rc.client_id=$1)
       )
       AND NOT EXISTS (
         SELECT 1 FROM route_client_exclusions x
         WHERE x.route_id=r.id AND x.client_id=$1
       )
     ORDER BY co.name NULLS LAST, r.name`,
    [clientId],
  );
  const { mccsForIso } = await import('@8xtel/core');
  const cardRates = client.pricing_profile_id
    ? await query<{ prefix: string | null; price: string }>(
        'SELECT prefix, price FROM client_rates WHERE profile_id=$1 ORDER BY length(COALESCE(prefix,\'\')) DESC',
        [client.pricing_profile_id],
      )
    : [];
  // Operator names per country: distinct prefixes.operator values; when the
  // DB has none (all NULL, as observed live), fall back to 'All'.
  const ops = await query<{ country_name: string | null; operator: string | null }>(
    `SELECT co.name AS country_name, p.operator
     FROM prefixes p JOIN countries co ON co.id=p.country_id
     WHERE p.operator IS NOT NULL AND p.operator <> ''
     GROUP BY co.name, p.operator`,
    [],
  ).catch(() => []);
  const opsByCountry = new Map<string, string[]>();
  for (const o of ops) {
    if (!o.country_name || !o.operator) continue;
    const list = opsByCountry.get(o.country_name) ?? [];
    if (!list.includes(o.operator)) list.push(o.operator);
    opsByCountry.set(o.country_name, list);
  }
  const rows: ClientRateRow[] = [];
  const time = fmtDate(validFrom);
  for (const r of routes) {
    // Priority: per-client override (038) → route default → cardRates. EUR-only.
    let price: number | null = r.rcr_price !== null && r.rcr_price !== undefined ? Number(r.rcr_price) : (r.price_per_segment !== null ? Number(r.price_per_segment) : null);
    let currency = r.rcr_price !== null && r.rcr_price !== undefined ? (r.rcr_currency ?? 'EUR') : (r.price_currency ?? 'EUR');
    if (price === null && r.prefix) {
      const hit = cardRates.find((c) => c.prefix && r.prefix!.startsWith(c.prefix));
      if (hit) { price = Number(hit.price); currency = client.currency; }
    }
    if (price === null || !Number.isFinite(price)) continue;
    // Only list rates in the client's own currency — never mislabel.
    if (currency !== client.currency) continue;
    // Never fall back to the route name: routes without a linked country
    // (e.g. 'HSP-OTP-INDIA') would leak internal route names into the file.
    if (!r.country_name) continue;
    const country = r.country_name;
    const mccs: string[] = r.iso_code ? (mccsForIso as (iso: string) => string[])(r.iso_code) : [];
    const mcc = mccs[0] ?? '';
    const operators = opsByCountry.get(country) ?? ['All'];
    for (const operator of operators) {
      rows.push({ country, operator, mcc, mnc: 'ALL', rate: price, currency, time });
    }
  }
  // Collapse identical rows so the sheet lists each opened destination once
  // instead of once per route.
  const seen = new Set<string>();
  const uniq = rows.filter((x) => {
    const k = [x.country, x.operator, x.mcc, x.mnc, x.rate, x.currency, x.time].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) =>
    a.country.localeCompare(b.country) || a.operator.localeCompare(b.operator) ||
    a.mcc.localeCompare(b.mcc) || a.mnc.localeCompare(b.mnc),
  );
  rows.length = 0;
  rows.push(...uniq);
  return {
    rows,
    currency: client.currency,
    countries: new Set(rows.map((r) => r.country)).size,
    networks: rows.length,
  };
}

export function attachmentFilename(accountId: string, systemId: string, d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const safe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `8xtel_Rates_${safe(accountId)}_${safe(systemId)}_${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}.xlsx`;
}

export async function buildClientRatesXlsx(args: {
  clientName: string; productName: string; accountId: string; systemId: string;
  currency: string; timezone: string; list: ClientRateList;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '8xtel';
  wb.created = new Date();
  const ws = wb.addWorksheet('Rates');
  // Panel theme: emerald brand #10B981 + sky accent #38BDF8 on slate #0F172A.
  // Top block: brand + account context, then the 7-column table.
  // No route/vendor names anywhere — only country operators.
  const band = ws.addRow(['8xtel — Rate List']);
  band.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
  band.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 28;
  const ctx = ws.addRow([`System ID: ${args.systemId}   Client ID: ${args.accountId}`]);
  ctx.font = { bold: true, color: { argb: 'FF0F172A' } };
  ctx.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
  const cur = ws.addRow([`Currency: ${args.currency}   Timezone: ${args.timezone}`]);
  cur.font = { bold: true, color: { argb: 'FF0F172A' } };
  cur.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([]);
  const header = ws.addRow(RN_COLUMNS);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  header.alignment = { vertical: 'middle' };
  args.list.rows.forEach((r, idx) => {
    const row = ws.addRow([r.country, r.operator, r.mcc, r.mnc, r.rate, r.currency, r.time]);
    row.getCell(5).numFmt = '0.0000';
    // Alternating emerald-tinted banding for readability.
    if (idx % 2 === 1) {
      for (let c = 1; c <= 7; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
      }
    }
  });
  ws.columns = [
    { width: 24 }, { width: 22 }, { width: 10 }, { width: 10 },
    { width: 14 }, { width: 10 }, { width: 14 },
  ];
  ws.views = [{ state: 'frozen', ySplit: RN_HEADER_ROW }];
  ws.autoFilter = {
    from: { row: RN_HEADER_ROW, column: 1 },
    to: { row: RN_HEADER_ROW - 1 + args.list.rows.length, column: 7 },
  };
  const lastRow = RN_HEADER_ROW - 1 + args.list.rows.length;
  for (let i = RN_HEADER_ROW; i <= lastRow; i++) {
    for (let c = 1; c <= 7; c++) {
      ws.getRow(i).getCell(c).border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as unknown as Uint8Array);
}
