import ExcelJS from 'exceljs';
import { query, queryOne } from '@8xtel/core';

export interface ClientRateRow {
  country: string;
  mcc: string;
  mnc: string;
  rate: number;
  date: string;
}

export const RN_HEADER_ROW = 8;
export const RN_COLUMNS = ['Country', 'MCC', 'MNC', 'Price', 'Date'];

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
// Price priority per route: route.price_per_segment → client_rates longest
// prefix match → skipped (no price = not billable = not listed).
export async function getClientActiveRates(clientId: string, validFrom: Date = new Date()): Promise<ClientRateList> {
  const client = await queryOne<{ name: string; company_name: string | null; system_id: string; currency: string; pricing_profile_id: string | null }>(
    'SELECT name, company_name, system_id, COALESCE(currency,\'EUR\') AS currency, pricing_profile_id FROM clients WHERE id=$1',
    [clientId],
  );
  if (!client) throw new Error('client not found');
  const routes = await query<{
    name: string; prefix: string | null; price_per_segment: string | null;
    price_currency: string | null; country_name: string | null; iso_code: string | null;
    calling_code: string | null;
  }>(
    `SELECT r.name, r.prefix, r.price_per_segment,
            COALESCE(r.price_currency,'EUR') AS price_currency,
            co.name AS country_name, co.iso_code, co.calling_code
     FROM routes r LEFT JOIN countries co ON co.id=r.country_id
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
  const rows: ClientRateRow[] = [];
  for (const r of routes) {
    let price: number | null = r.price_per_segment !== null ? Number(r.price_per_segment) : null;
    let currency = r.price_currency ?? 'EUR';
    if (price === null && r.prefix) {
      const hit = cardRates.find((c) => c.prefix && r.prefix!.startsWith(c.prefix));
      if (hit) { price = Number(hit.price); currency = client.currency; }
    }
    if (price === null || !Number.isFinite(price)) continue;
    // Only list rates in the client's own currency — never mislabel.
    if (currency !== client.currency) continue;
    const mccs: string[] = r.iso_code ? (mccsForIso as (iso: string) => string[])(r.iso_code) : [];
    const mcc = mccs[0] ?? '';
    rows.push({ country: r.country_name ?? r.name, mcc, mnc: 'ALL', rate: price, date: fmtDate(validFrom) });
  }
  // Collapse identical rows (same country/MCC/MNC/rate/date) so the sheet
  // lists each opened destination once instead of once per route.
  const seen = new Set<string>();
  const uniq = rows.filter((x) => {
    const k = [x.country, x.mcc, x.mnc, x.rate, x.date].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) =>
    a.country.localeCompare(b.country) || a.mcc.localeCompare(b.mcc) || a.mnc.localeCompare(b.mnc),
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
  // Top block: brand + account context, then the 5-column table.
  const title = ws.addRow(['8xtel']);
  title.font = { bold: true, size: 16 };
  ws.addRow([`System ID: ${args.systemId}   Client ID: ${args.accountId}`]);
  ws.addRow([`Currency: ${args.currency}   Timezone: ${args.timezone}`]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow([]);
  const header = ws.addRow(RN_COLUMNS);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  header.alignment = { vertical: 'middle' };
  for (const r of args.list.rows) {
    const row = ws.addRow([r.country, r.mcc, r.mnc, r.rate, r.date]);
    row.getCell(4).numFmt = '0.0000';
  }
  ws.columns = [
    { width: 24 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 14 },
  ];
  ws.views = [{ state: 'frozen', ySplit: RN_HEADER_ROW }];
  ws.autoFilter = {
    from: { row: RN_HEADER_ROW, column: 1 },
    to: { row: RN_HEADER_ROW - 1 + args.list.rows.length, column: 5 },
  };
  const lastRow = RN_HEADER_ROW - 1 + args.list.rows.length;
  for (let i = RN_HEADER_ROW; i <= lastRow; i++) {
    for (let c = 1; c <= 5; c++) {
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
