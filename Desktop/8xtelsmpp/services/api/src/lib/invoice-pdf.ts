export interface InvoiceLine {
  country_name: string; iso_code: string | null; total_sms: number;
  successful: number; failed: number; segments: number;
  rate: number; amount: number; percentage: number;
}
export interface InvoiceDoc {
  invoice_number: string; period_from: string; period_to: string;
  currency: string; subtotal: number; tax_rate: number; tax_amount: number;
  adjustments: number; grand_total: number; status: string; notes: string | null;
  created_at: string; client: { name: string; company_name: string | null; system_id: string; email: string | null };
  lines: InvoiceLine[];
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(n: number, ccy = 'EUR'): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: ccy, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function buildInvoiceHtml(doc: InvoiceDoc): string {
  const rows = doc.lines.map((l) => `
    <tr>
      <td>${esc(l.country_name)}${l.iso_code ? ` <span style="color:#64748b;font-size:11px">${esc(l.iso_code)}</span>` : ''}</td>
      <td style="text-align:right">${l.total_sms.toLocaleString()}</td>
      <td style="text-align:right;color:#059669">${l.successful.toLocaleString()}</td>
      <td style="text-align:right;color:#dc2626">${l.failed.toLocaleString()}</td>
      <td style="text-align:right">${l.segments.toLocaleString()}</td>
      <td style="text-align:right">${l.rate.toFixed(4)}</td>
      <td style="text-align:right;font-weight:600">${fmt(l.amount, doc.currency)}</td>
      <td style="text-align:right">${l.percentage.toFixed(1)}%</td>
    </tr>`).join('');
  const totalSms = doc.lines.reduce((s, l) => s + l.total_sms, 0);
  const totalSeg = doc.lines.reduce((s, l) => s + l.segments, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.invoice_number)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Inter,system-ui,Arial,sans-serif;color:#0f172a;margin:0;padding:32px;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #10b981;padding-bottom:16px;margin-bottom:20px}
    .brand{font-size:22px;font-weight:800}.brand span{color:#10b981}
    .meta{font-size:11px;color:#64748b;text-align:right}
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase}
    .badge-paid{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
    .badge-sent{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
    .badge-generated{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
    .badge-overdue{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
    .card{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc}
    .card h3{margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#475569;background:#f1f5f9;padding:8px 6px;text-align:left;border-bottom:1px solid #e2e8f0}
    td{padding:7px 6px;border-bottom:1px solid #f1f5f9;font-size:12px}
    tfoot td{font-weight:700;background:#f8fafc;border-top:2px solid #e2e8f0}
    .totals{margin-left:auto;width:320px;margin-top:16px}
    .totals div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9}
    .totals .grand{font-weight:800;font-size:14px;border-top:2px solid #0f172a;margin-top:6px;padding-top:8px}
    .footer{margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;text-align:center}
    @media print{body{padding:16px}}
  </style></head><body>
  <div class="header">
    <div><div class="brand">8xtel<span>SMPP</span></div><div style="font-size:11px;color:#64748b;letter-spacing:.12em;text-transform:uppercase">Messaging Gateway</div></div>
    <div class="meta">
      <div style="font-size:16px;font-weight:800;color:#0f172a">${esc(doc.invoice_number)}</div>
      <div>${esc(doc.period_from)} → ${esc(doc.period_to)}</div>
      <div style="margin-top:6px"><span class="badge badge-${esc(doc.status)}">${esc(doc.status)}</span></div>
      <div style="margin-top:4px">Issued ${new Date(doc.created_at).toLocaleDateString()}</div>
    </div>
  </div>
  <div class="grid">
    <div class="card"><h3>Bill to</h3><div style="font-weight:700">${esc(doc.client.name)}</div>${doc.client.company_name ? `<div>${esc(doc.client.company_name)}</div>` : ''}<div style="font-family:monospace;font-size:12px">${esc(doc.client.system_id)}</div>${doc.client.email ? `<div style="color:#64748b">${esc(doc.client.email)}</div>` : ''}</div>
    <div class="card"><h3>Invoice details</h3><div>Currency: <b>${esc(doc.currency)}</b></div><div>Period: <b>${esc(doc.period_from)} to ${esc(doc.period_to)}</b></div><div>Total SMS: <b>${totalSms.toLocaleString()}</b></div><div>Segments: <b>${totalSeg.toLocaleString()}</b></div></div>
  </div>
  <table><thead><tr><th>Country</th><th style="text-align:right">SMS</th><th style="text-align:right">Delivered</th><th style="text-align:right">Failed</th><th style="text-align:right">Segments</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th><th style="text-align:right">%</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#64748b;padding:20px">No billable traffic in this period.</td></tr>`}</tbody>
  <tfoot><tr><td>Total</td><td style="text-align:right">${totalSms.toLocaleString()}</td><td style="text-align:right">${doc.lines.reduce((s, l) => s + l.successful, 0).toLocaleString()}</td><td style="text-align:right">${doc.lines.reduce((s, l) => s + l.failed, 0).toLocaleString()}</td><td style="text-align:right">${totalSeg.toLocaleString()}</td><td></td><td style="text-align:right">${fmt(doc.subtotal, doc.currency)}</td><td style="text-align:right">100%</td></tr></tfoot></table>
  <div class="totals">
    <div><span>Subtotal</span><span>${fmt(doc.subtotal, doc.currency)}</span></div>
    <div><span>Tax (${doc.tax_rate}%)</span><span>${fmt(doc.tax_amount, doc.currency)}</span></div>
    <div><span>Adjustments</span><span>${fmt(doc.adjustments, doc.currency)}</span></div>
    <div class="grand"><span>Grand total</span><span>${fmt(doc.grand_total, doc.currency)}</span></div>
  </div>
  ${doc.notes ? `<div style="margin-top:16px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#fffbeb"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#92400e;font-weight:700">Notes</div><div style="margin-top:4px;white-space:pre-wrap">${esc(doc.notes)}</div></div>` : ''}
  <div class="footer">This is a system-generated invoice from 8xtelSMPP. For queries contact billing@8xtelsmpp.com</div>
  </body></html>`;
}

export function invoiceHtmlToPdfBuffer(html: string): Buffer {
  // Lightweight: return HTML bytes with PDF header hint. If pdfkit is installed
  // in the future, swap this for a real PDFKit render. Keeping the runtime
  // lean (no Chromium/puppeteer) matches the existing VPS image.
  return Buffer.from(html, 'utf8');
}
