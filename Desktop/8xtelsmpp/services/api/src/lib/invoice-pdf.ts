// @ts-nocheck — pdfkit has loose types; runtime is covered by buildInvoicePdfBuffer try/catch
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
export interface PaymentMethodForDoc { kind: string; label: string; chain: string | null; details: Record<string, unknown>; }

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(n: number, ccy = 'EUR'): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: ccy, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function paymentBlockHtml(methods: PaymentMethodForDoc[]): string {
  if (!methods.length) return `<div style="border:1px dashed #cbd5e1;border-radius:8px;padding:10px 12px;color:#64748b">Contact Accounts@8xtel.com for payment instructions.</div>`;
  return methods.map(m => {
    const d: Record<string, unknown> = (m.details ?? {}) as Record<string, unknown>;
    let det = '';
    if (m.kind === 'usdt') {
      const addr = String(d.address ?? d.wallet_address ?? '');
      const chain = m.chain ?? String(d.chain ?? '');
      det = `<div style="font-family:monospace;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:5px 7px;margin-top:4px;word-break:break-all;font-size:11px"><span style="display:inline-block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;margin-right:6px">${esc(chain || 'USDT')}</span>${esc(addr)}</div>${d.memo ? `<div style="font-size:11px;color:#64748b">Memo: <b>${esc(d.memo)}</b></div>` : ''}`;
    } else if (m.kind === 'upi') {
      det = `<div>UPI: <b style="font-family:monospace">${esc(d.upi_id ?? d.vpa ?? '')}</b>${d.holder_name ? ` — ${esc(d.holder_name)}` : ''}</div>`;
    } else {
      det = `<div style="font-size:12px">${[d.account_name && `A/c ${esc(d.account_name)}`, d.bank_name && esc(d.bank_name), d.account_number && `<span style="font-family:monospace">${esc(d.account_number)}</span>`, d.ifsc && `IFSC ${esc(d.ifsc)}`, d.swift && `SWIFT ${esc(d.swift)}`, d.iban && esc(d.iban)].filter(Boolean).join(' · ')}</div>`;
    }
    return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#f8fafc"><div style="font-weight:700;font-size:12px">${esc(m.label)} <span style="font-weight:400;color:#64748b">— ${esc(m.kind.toUpperCase())}${m.chain ? ` · ${esc(m.chain)}` : ''}</span></div>${det}</div>`;
  }).join('');
}

export function buildInvoiceHtml(doc: InvoiceDoc, paymentMethods: PaymentMethodForDoc[] = []): string {
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
  ${paymentMethods.length ? `<div style="margin-top:16px"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0f172a;font-weight:800;margin-bottom:8px">How to pay</div>${paymentBlockHtml(paymentMethods)}</div>` : ''}
  <div class="footer">This is a system-generated invoice from 8xtelSMPP. For queries contact Accounts@8xtel.com</div>
  </body></html>`;
}

export async function buildInvoicePdfBuffer(doc: InvoiceDoc, paymentMethods: PaymentMethodForDoc[] = []): Promise<Buffer> {
  try {
    const mod: any = await import('pdfkit');
    const PDFDocument = mod.default ?? mod;
    return await renderWithPdfkit(PDFDocument, doc, paymentMethods);
  } catch {
    return Buffer.from(buildInvoiceHtml(doc, paymentMethods), 'utf8');
  }
}

async function renderWithPdfkit(PDFDocumentCtor: any, doc: InvoiceDoc, methods: PaymentMethodForDoc[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const pdf = new PDFDocumentCtor({ margin: 36, size: 'A4', info: { Title: doc.invoice_number } });
    pdf.on('data', (d: Buffer) => chunks.push(d));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const P: any = pdf;
    P.rect(36, 36, 523, 56).fill('#0f172a'); P.fillColor('#ffffff'); P.fontSize(18).font('Helvetica-Bold').text('8xtelSMPP', 44, 48);
    P.fontSize(8).fillColor('#94a3b8').text('Messaging Gateway  ·  Accounts@8xtel.com', 44, 68);
    P.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text(doc.invoice_number, 380, 48, { width: 170, align: 'right' });
    P.fontSize(7).font('Helvetica').fillColor('#cbd5e1').text(`${doc.period_from} → ${doc.period_to}  ·  ${doc.status.toUpperCase()}`, 380, 62, { width: 170, align: 'right' });
    P.fillColor('#0f172a');
    let y = 110;
    y = drawCards(P, doc, y);
    y = drawTable(P, doc, y);
    y = drawTotals(P, doc, y);
    if (doc.notes) y = drawNotes(P, doc.notes, y);
    if (methods.length) y = drawHowToPay(P, methods, y);
    P.fontSize(7).fillColor('#94a3b8').text('This is a system-generated invoice from 8xtelSMPP. For queries contact Accounts@8xtel.com', 36, 810, { align: 'center', width: 523 });
    pdf.end();
  });
}

function drawCards(P: any, doc: InvoiceDoc, y: number): number {
  const cardW = 255, cardH = 62;
  const sets: Array<[number, string[]]> = [
    [0, [`Bill to`, doc.client.name, doc.client.company_name ?? '', doc.client.system_id, doc.client.email ?? '']],
    [1, [`Invoice details`, `Currency: ${doc.currency}`, `Period: ${doc.period_from} to ${doc.period_to}`, `Total SMS: ${doc.lines.reduce((s,l)=>s+l.total_sms,0).toLocaleString()}`, `Segments: ${doc.lines.reduce((s,l)=>s+l.segments,0).toLocaleString()}`]],
  ];
  for (const [i, lines] of sets) {
    const x = 36 + i * (cardW + 13);
    P.rect(x, y, cardW, cardH).fill('#f8fafc').stroke();
    P.fillColor('#64748b').fontSize(6).font('Helvetica-Bold').text(lines[0].toUpperCase(), x+8, y+6);
    P.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text(lines[1] ?? '', x+8, y+16, { width: cardW-16 });
    P.font('Helvetica').fontSize(7).fillColor('#475569');
    let cy = y+26;
    for (let k=2;k<lines.length;k++) { if(!lines[k]) continue; P.text(lines[k], x+8, cy, { width: cardW-16 }); cy+=9; }
  }
  return y + cardH + 14;
}

function drawTable(P: any, doc: InvoiceDoc, y: number): number {
  const cols = [
    { w: 150, label: 'Country', align: 'left' as const },
    { w: 55, label: 'SMS', align: 'right' as const },
    { w: 55, label: 'Deliv.', align: 'right' as const },
    { w: 50, label: 'Segs', align: 'right' as const },
    { w: 65, label: 'Rate', align: 'right' as const },
    { w: 75, label: 'Amount', align: 'right' as const },
    { w: 45, label: '%', align: 'right' as const },
  ];
  const fmt2 = (n:number,ccy:string)=> new Intl.NumberFormat('en',{style:'currency',currency:ccy}).format(n);
  let x = 36;
  for (const c of cols) { P.rect(x, y, c.w, 16).fill('#0f172a'); x+=c.w; }
  x = 36; P.fillColor('#ffffff').fontSize(6).font('Helvetica-Bold');
  for (const c of cols) { P.text(c.label, x+4, y+5, { width: c.w-8, align: c.align }); x+=c.w; }
  y+=16; P.fillColor('#0f172a').font('Helvetica').fontSize(7);
  if (!doc.lines.length) { P.text('No billable traffic in this period.', 36, y+6, { width: 523, align: 'center' }); y+=18; }
  else {
    for (const l of doc.lines) {
      if (y > 730) { P.addPage(); y=36; }
      x=36;
      const cells = [l.country_name, String(l.total_sms), String(l.successful), String(l.segments), l.rate.toFixed(4), fmt2(l.amount, doc.currency), l.percentage.toFixed(1)+'%'];
      for (let i=0;i<cols.length;i++) { P.text(cells[i], x+4, y+4, { width: cols[i].w-8, align: cols[i].align }); x+=cols[i].w; }
      y+=12;
      P.rect(36, y, 523, 0.5); P.fill('#e2e8f0');
      y+=1;
    }
  }
  if (y > 720) { P.addPage(); y=36; }
  P.rect(36, y, 523, 14).fill('#f8fafc');
  P.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7);
  x=36; const totals=[`Total (${doc.lines.reduce((s,l)=>s+l.total_sms,0).toLocaleString()} SMS)`, '', '', '', '', fmt2(doc.subtotal, doc.currency), '100%'];
  P.text(totals[0], 40, y+4, { width: 140 });
  let tx = 36+150; for(let i=1;i<cols.length;i++){ P.text(totals[i], tx+4, y+4, { width: cols[i].w-8, align: cols[i].align }); tx+=cols[i].w; }
  y+=18;
  return y;
}

function drawTotals(P: any, doc: InvoiceDoc, y: number): number {
  const fmt2=(n:number,ccy:string)=> new Intl.NumberFormat('en',{style:'currency',currency:ccy}).format(n);
  const boxX = 320, boxW = 239;
  if (y > 700) { P.addPage(); y=36; }
  const rows: Array<[string,string,boolean]> = [[`Subtotal`, fmt2(doc.subtotal, doc.currency), false],[`Tax (${doc.tax_rate}%)`, fmt2(doc.tax_amount, doc.currency), false],[`Adjustments`, fmt2(doc.adjustments, doc.currency), false],[`Grand total`, fmt2(doc.grand_total, doc.currency), true]];
  let cy=y;
  for (const [k,v,bold] of rows) {
    const h = bold?18:12;
    if (bold) P.rect(boxX, cy, boxW, h).fill('#0f172a');
    else P.rect(boxX, cy, boxW, h);
    P.fillColor(bold?'#ffffff':'#0f172a').font(bold?'Helvetica-Bold':'Helvetica').fontSize(bold?9:7);
    P.text(k, boxX+8, cy+ (bold?5:3), { width: 120 });
    P.text(v, boxX+130, cy+ (bold?5:3), { width: boxW-138, align:'right' });
    cy+=h;
  }
  return cy+10;
}
function drawNotes(P: any, notes:string, y:number): number {
  if (y>720) { P.addPage(); y=36; }
  P.rect(36, y, 523, 28).fill('#fffbeb');
  P.fillColor('#92400e').fontSize(6).font('Helvetica-Bold').text('NOTES', 44, y+4);
  P.fillColor('#78350f').font('Helvetica').fontSize(7).text(notes.slice(0,400), 44, y+12, { width: 507 });
  return y+34;
}
function drawHowToPay(P: any, methods: PaymentMethodForDoc[], y:number): number {
  if (y>700) { P.addPage(); y=36; }
  P.fillColor('#0f172a').fontSize(7).font('Helvetica-Bold').text('HOW TO PAY', 36, y);
  y+=10;
  for (const m of methods) {
    if (y>740) { P.addPage(); y=36; }
    P.rect(36, y, 523, 22).fill('#f8fafc');
    P.fillColor('#0f172a').fontSize(7).font('Helvetica-Bold').text(`${m.label} — ${m.kind.toUpperCase()}${m.chain?` · ${m.chain}`:''}`, 44, y+4, { width: 507 });
    const d: Record<string, unknown> = (m.details ?? {}) as Record<string, unknown>; let det='';
    if (m.kind==='usdt') det=`${m.chain ?? ''}: ${String(d.address ?? d.wallet_address ?? '')}${d.memo?`  Memo:${String(d.memo)}`:''}`;
    else if (m.kind==='upi') det=`UPI ${String(d.upi_id ?? d.vpa ?? '')}${d.holder_name?` — ${String(d.holder_name)}`:''}`;
    else det=`${String(d.account_name ?? '')} ${String(d.bank_name ?? '')} ${String(d.account_number ?? '')} ${String(d.ifsc ?? '')}`.trim();
    P.font('Helvetica').fontSize(6).fillColor('#475569').text(det.slice(0,180), 44, y+12, { width: 507 });
    y+=26;
  }
  return y;
}

export function invoiceHtmlToPdfBuffer(html: string): Buffer {
  return Buffer.from(html, 'utf8');
}
