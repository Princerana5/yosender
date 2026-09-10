/**
 * Minimal XLSX export without external deps — builds a real .xlsx (ZIP + XML) in pure JS.
 * Uses no npm package so it works on Vercel without extra install.
 * For import we parse via simple CSV fallback + XLSX XML parsing.
 */

// ── Helpers ──
function escXml(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x >= 0) {
    s = String.fromCharCode((x % 26) + 65) + s;
    x = Math.floor(x / 26) - 1;
  }
  return s;
}
function cellRef(col: number, row: number): string {
  return colLetter(col) + (row + 1);
}

// CRC32 for ZIP
function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Build a minimal ZIP (STORE only, no compression) — valid XLSX
function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header
    view.setUint16(4, 20, true); // version
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // method STORE
    view.setUint16(10, 0, true); // time
    view.setUint16(12, 0, true); // date
    view.setUint32(14, crc, true);
    view.setUint32(18, f.data.length, true);
    view.setUint32(22, f.data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    parts.push(header, f.data);

    // central directory
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += header.length + f.data.length;
  }

  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const centralOffset = offset;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

function u8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ── Worksheet XML ──
type SheetDef = { name: string; headers: string[]; rows: string[][]; colWidths?: number[] };

function sheetXml(sheet: SheetDef): string {
  const cols = sheet.headers.length;
  const colWidths = sheet.colWidths || sheet.headers.map((h) => Math.max(12, Math.min(40, h.length + 8)));
  // ensure at least as many widths as cols
  while (colWidths.length < cols) colWidths.push(15);

  const colsXml = colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");

  // header row (row 1) — bold via style 1
  const headerCells = sheet.headers
    .map((h, c) => `<c r="${cellRef(c, 0)}" t="inlineStr" s="1"><is><t>${escXml(h)}</t></is></c>`)
    .join("");

  const dataRows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((val, c) => {
          const v = String(val ?? "");
          // detect number?
          // keep as string to preserve formatting (dates, etc.)
          return `<c r="${cellRef(c, r + 1)}" t="inlineStr"><is><t>${escXml(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 2}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${colsXml}</cols><sheetData><row r="1" ht="18" customHeight="1">${headerCells}</row>${dataRows}</sheetData><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><autoFilter ref="A1:${colLetter(cols - 1)}1"/></worksheet>`;
}

// ── Public: build XLSX (via the xlsx lib — the old hand-rolled ZIP writer
// produced files Excel sometimes refused to open) ──
export function buildXlsx(sheets: SheetDef[]): Uint8Array {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const X = require("xlsx");
    const wb = X.utils.book_new();
    for (const s of sheets) {
      const safe = String(s.name || "Sheet").replace(/[:\\/?*[\]]/g, "_").slice(0, 31) || "Sheet";
      const ws = X.utils.aoa_to_sheet([s.headers, ...s.rows]);
      ws["!cols"] = (s.colWidths || s.headers.map(() => 20)).map((w: number) => ({ wch: Math.max(10, Math.min(50, w)) }));
      X.utils.book_append_sheet(wb, ws, safe);
    }
    const buf: Buffer = X.write(wb, { type: "buffer", bookType: "xlsx" });
    return new Uint8Array(buf);
  } catch {
    return buildXlsxLegacy(sheets);
  }
}

function buildXlsxLegacy(sheets: SheetDef[]): Uint8Array {
  const sheetNames = sheets.map((s) => s.name);
  // sanitize sheet names (max 31 chars, no : \ / ? * [ ])
  const safeNames = sheetNames.map((n) => n.replace(/[:\\\/\?\*\[\]]/g, "_").slice(0, 31) || "Sheet");

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeNames
    .map((n, i) => `<sheet name="${escXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safeNames
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("")}<Relationship Id="rId${safeNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${safeNames
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF229ED9"/><bgColor indexed="64"/></patternFill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;

  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: "[Content_Types].xml", data: u8(contentTypesXml) },
    { name: "_rels/.rels", data: u8(relsXml) },
    { name: "xl/workbook.xml", data: u8(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: u8(workbookRelsXml) },
    { name: "xl/styles.xml", data: u8(stylesXml) },
  ];
  sheets.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: u8(sheetXml(s)) });
  });

  return buildZip(files);
}

export const GROUP_EXPORT_HEADERS = [
  "Group Name",
  "Group Link",
  "Normalized Link",
  "Group Type",
  "Group Username",
  "Category",
  "Status",
  "Source",
  "Submitted By",
  "Submitted Email",
  "First Added Date",
  "Last Seen Date",
  "Notes",
  "Admin Notes",
];

export function groupToRow(g: any): string[] {
  return [
    g.group_name || "",
    g.group_link || "",
    g.normalized_link || "",
    g.group_type || "",
    g.group_username || "",
    g.category_name || "",
    g.status || "",
    g.source || "",
    g.submitted_by_name || "",
    g.submitted_by_email || "",
    g.first_added_at ? new Date(g.first_added_at).toLocaleString() : "",
    g.last_seen_at ? new Date(g.last_seen_at).toLocaleString() : "",
    g.notes || "",
    g.admin_notes || "",
  ];
}
