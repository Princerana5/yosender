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
    // Only list rates in the client's own currency — never mislabel (trim CHAR padding).
    if (String(currency).trim().toUpperCase() !== String(client.currency ?? 'EUR').trim().toUpperCase()) continue;
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
  const ws = wb.addWorksheet('Rates', {
    properties: { defaultRowHeight: 18 },
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true },
  });
  ws.properties.defaultRowHeight = 18;
  // Brand palette — matches panel (emerald #10B981, slate #0F172A, sky #0EA5E9) + RateNotifications email header
  const EMERALD = 'FF0CBF8A';
  const EMERALD_DARK = 'FF0A8F6A';
  const SLATE = 'FF0F172A';
  const SKY = 'FF38BDF8';
  const SLATE_LIGHT = 'FFF1F5F9';
  const BORDER_CLR = 'FFE2E8F0';
  const BAND = 'FFF0FDF4';

  // ── Title band
  const brand = ws.addRow(['8XTEL — Rate List']);
  brand.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' }, name: 'Inter' };
  brand.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMERALD } };
  brand.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 34;
  ws.mergeCells('A1:G1');

  // ── Client / account context
  const meta = ws.addRow([`Client: ${args.clientName}  ·  System ID: ${args.systemId}  ·  Account: ${args.accountId}`]);
  meta.font = { size: 9, color: { argb: 'FF475569' }, name: 'Inter', italic: true };
  meta.alignment = { vertical: 'middle' };
  ws.mergeCells('A2:G2');
  ws.getRow(2).height = 18;
  const meta2 = ws.addRow([`Currency: ${args.currency}  ·  Timezone: ${args.timezone}  ·  Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC  ·  Destinations: ${args.list.rows.length}  ·  Countries: ${args.list.countries}`]);
  meta2.font = { size: 8, color: { argb: 'FF64748B' }, name: 'Inter' };
  meta2.alignment = { vertical: 'middle' };
  ws.mergeCells('A3:G3');
  ws.getRow(3).height = 16;
  // thin emerald rule
  const rule = ws.addRow(['']);
  rule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMERALD } };
  ws.getRow(4).height = 2;
  ws.mergeCells('A4:G4');
  ws.addRow([]);
  ws.getRow(5).height = 4;
  ws.addRow([]);
  ws.getRow(6).height = 4;
  ws.addRow([]);
  ws.getRow(7).height = 4;
  const header = ws.addRow(RN_COLUMNS);
  header.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Inter' };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SLATE } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 22;
  for (let c = 1; c <= 7; c++) {
    const cell = header.getCell(c);
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_CLR } },
      bottom: { style: 'thin', color: { argb: BORDER_CLR } },
      left: { style: 'thin', color: { argb: BORDER_CLR } },
      right: { style: 'thin', color: { argb: BORDER_CLR } },
    };
  }
  args.list.rows.forEach((r, idx) => {
    const row = ws.addRow([r.country, r.operator, r.mcc, r.mnc, r.rate, r.currency, r.time]);
    row.height = 17;
    row.font = { size: 9, name: 'Inter', color: { argb: 'FF1E293B' } };
    row.getCell(1).alignment = { horizontal: 'left' };
    row.getCell(2).alignment = { horizontal: 'left' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'right' };
    row.getCell(5).numFmt = '0.0000';
    row.getCell(5).font = { size: 9, name: 'JetBrains Mono', color: { argb: 'FF0F172A' }, bold: true };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).alignment = { horizontal: 'center' };
    // Alternating band
    if (idx % 2 === 1) {
      for (let c = 1; c <= 7; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
      }
    }
    // Currency pill tint on Rate cell border
    for (let c = 1; c <= 7; c++) {
      row.getCell(c).border = {
        top: { style: 'thin', color: { argb: BORDER_CLR } },
        bottom: { style: 'thin', color: { argb: BORDER_CLR } },
        left: { style: 'thin', color: { argb: BORDER_CLR } },
        right: { style: 'thin', color: { argb: BORDER_CLR } },
      };
    }
  });
  // Footer note
  const footRow = ws.addRow(['Rates are per segment, EUR · Contact rates@8xtel.com for questions']);
  footRow.font = { size: 7, color: { argb: 'FF94A3B8' }, name: 'Inter', italic: true };
  footRow.alignment = { horizontal: 'center' };
  ws.mergeCells(`A${RN_HEADER_ROW + args.list.rows.length + 1}:G${RN_HEADER_ROW + args.list.rows.length + 1}`);
  ws.getRow(RN_HEADER_ROW + args.list.rows.length + 1).height = 14;

  ws.columns = [
    { width: 26 }, { width: 24 }, { width: 10 }, { width: 10 },
    { width: 14 }, { width: 10 }, { width: 14 },
  ];
  ws.views = [{ state: 'frozen', ySplit: RN_HEADER_ROW }];
  // Print titles + filter
  ws.autoFilter = {
    from: { row: RN_HEADER_ROW, column: 1 },
    to: { row: RN_HEADER_ROW - 1 + args.list.rows.length, column: 7 },
  };
  // Print setup: repeat header row, fit to width
  (ws as unknown as { pageSetup: Record<string, unknown> }).pageSetup.printTitlesRow = `${RN_HEADER_ROW}:${RN_HEADER_ROW}`;
  (ws as unknown as { headerFooter: Record<string, string> }).headerFooter.oddHeader = '&C&10&K8A9B8A 8XTEL Rate List  &R &K64748B Page &P of &N';
  (ws as unknown as { headerFooter: Record<string, string> }).headerFooter.oddFooter = '&C&8&K94A3B8 Rates per segment · Generated ' + new Date().toISOString().slice(0, 10) + ' UTC';

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as unknown as Uint8Array);
}
