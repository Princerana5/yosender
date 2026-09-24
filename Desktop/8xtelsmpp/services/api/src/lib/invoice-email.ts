import type { InvoiceDoc } from './invoice-pdf.js';

export interface InvoiceEmailArgs {
  doc: InvoiceDoc;
  paymentMethods: Array<{ kind: string; label: string; chain: string | null; details: Record<string, unknown> }>;
  panelUrl: string;
  invoiceId: string;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n: number, ccy='EUR'): string {
  return new Intl.NumberFormat('en', { style:'currency', currency: ccy }).format(n);
}

function howToPayHtml(methods: InvoiceEmailArgs['paymentMethods']): string {
  if (!methods.length) return '<p style="color:#64748b">Contact Accounts@8xtel.com for payment instructions.</p>';
  return methods.map(m => {
    const d = m.details ?? {};
    let detailLine = '';
    if (m.kind === 'usdt') {
      const addr = String(d.address ?? d.wallet_address ?? '');
      const chain = m.chain ?? String(d.chain ?? 'TRC20');
      detailLine = `<div style="font-family:monospace;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px;margin-top:4px;word-break:break-all"><span style="display:inline-block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;margin-right:6px">${esc(chain)}</span>${esc(addr)}</div>`;
      if (d.memo) detailLine += `<div style="font-size:11px;color:#64748b;margin-top:4px">Memo/Tag: <b>${esc(d.memo)}</b></div>`;
    } else if (m.kind === 'upi') {
      detailLine = `<div style="margin-top:4px">UPI ID: <b style="font-family:monospace">${esc(d.upi_id ?? d.vpa ?? '')}</b>${d.holder_name ? ` — ${esc(d.holder_name)}` : ''}</div>`;
    } else {
      detailLine = `<div style="margin-top:4px;font-size:13px">${[d.account_name && `A/c: <b>${esc(d.account_name)}</b>`, d.bank_name && `Bank: <b>${esc(d.bank_name)}</b>`, d.account_number && `No: <b style="font-family:monospace">${esc(d.account_number)}</b>`, d.ifsc && `IFSC: <b>${esc(d.ifsc)}</b>`, d.swift && `SWIFT: <b>${esc(d.swift)}</b>`, d.iban && `IBAN: <b>${esc(d.iban)}</b>`].filter(Boolean).join(' · ')}</div>`;
    }
    return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#f8fafc">
      <div style="font-weight:700">${esc(m.label)} <span style="font-weight:400;color:#64748b;font-size:12px">— ${esc(m.kind.toUpperCase())}${m.chain ? ` · ${esc(m.chain)}` : ''}</span></div>
      ${detailLine}
    </div>`;
  }).join('');
}

export function buildInvoiceEmailHtml(args: InvoiceEmailArgs): string {
  const d = args.doc;
  const rows = d.lines.map(l => `<tr>
    <td style="padding:7px 8px;border:1px solid #e2e8f0">${esc(l.country_name)} <span style="color:#64748b;font-size:11px">${esc(l.iso_code ?? '')}</span></td>
    <td style="padding:7px 8px;border:1px solid #e2e8f0;text-align:right">${l.total_sms.toLocaleString()}</td>
    <td style="padding:7px 8px;border:1px solid #e2e8f0;text-align:right">${fmt(l.amount, d.currency)}</td>
    <td style="padding:7px 8px;border:1px solid #e2e8f0;text-align:right">${l.percentage.toFixed(1)}%</td>
  </tr>`).join('');
  const totalSms = d.lines.reduce((s,l)=>s+l.total_sms,0);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Arial,Helvetica,sans-serif">
<div style="max-width:640px;margin:0 auto;background:#ffffff">
  <div style="background:#0f172a;color:#fff;padding:20px 28px">
    <div style="font-size:20px;font-weight:800">8xtel<span style="color:#10b981">SMPP</span> <span style="font-weight:400;font-size:13px;color:#94a3b8;margin-left:8px">Invoice — ${esc(d.invoice_number)}</span></div>
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-top:2px">Messaging Gateway · Accounts@8xtel.com</div>
  </div>
  <div style="padding:28px;color:#0f172a;font-size:14px;line-height:1.6">
    <p>Dear ${esc(d.client.name)} team,</p>
    <p>Please find your invoice for <b>${esc(d.period_from)} → ${esc(d.period_to)}</b> attached as PDF. Summary below:</p>
    <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px">
      <thead><tr style="background:#0f172a;color:#fff"><th style="padding:8px;border:1px solid #0f172a;text-align:left">Country</th><th style="padding:8px;border:1px solid #0f172a;text-align:right">SMS</th><th style="padding:8px;border:1px solid #0f172a;text-align:right">Amount</th><th style="padding:8px;border:1px solid #0f172a;text-align:right">%</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:16px">No billable traffic in this period.</td></tr>`}</tbody>
      <tfoot><tr style="background:#f8fafc;font-weight:700"><td style="padding:7px 8px;border:1px solid #e2e8f0">Total (${totalSms.toLocaleString()} SMS)</td><td style="padding:7px 8px;border:1px solid #e2e8f0;text-align:right">${totalSms.toLocaleString()}</td><td style="padding:7px 8px;border:1px solid #e2e8f0;text-align:right">${fmt(d.grand_total, d.currency)}</td><td style="padding:7px 8px;border:1px solid #e2e8f0;text-align:right">100%</td></tr></tfoot>
    </table>
    <div style="display:flex;justify-content:flex-end"><div style="width:300px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <div style="display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #f1f5f9"><span>Subtotal</span><span>${fmt(d.subtotal, d.currency)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #f1f5f9"><span>Tax (${d.tax_rate}%)</span><span>${fmt(d.tax_amount, d.currency)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #f1f5f9"><span>Adjustments</span><span>${fmt(d.adjustments, d.currency)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:10px;font-weight:800;background:#0f172a;color:#fff"><span>Grand total</span><span>${fmt(d.grand_total, d.currency)}</span></div>
    </div></div>
    <div style="margin-top:18px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0f172a;font-weight:800;margin-bottom:8px">How to pay</div>
      ${howToPayHtml(args.paymentMethods)}
      <div style="margin-top:10px"><a href="${esc(args.panelUrl)}/portal/invoices/${esc(args.invoiceId)}" style="display:inline-block;background:#10b981;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">View &amp; submit payment</a></div>
      <div style="font-size:11px;color:#64748b;margin-top:6px">After paying, submit the transaction reference on the portal — Accounts will verify and mark the invoice as <b>paid</b>.</div>
    </div>
    ${d.notes ? `<div style="margin-top:14px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:10px 12px"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#92400e;font-weight:700">Notes</div><div style="margin-top:4px;white-space:pre-wrap">${esc(d.notes)}</div></div>` : ''}
    <p style="margin-top:18px">Attachment: <b>Invoice_${esc(d.invoice_number)}.pdf</b></p>
    <p>Regards,<br><strong>8xtel Accounts</strong><br><a href="mailto:Accounts@8xtel.com">Accounts@8xtel.com</a></p>
  </div>
  <div style="background:#f8fafc;padding:10px 28px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0">This is an automated invoice from 8xtel Accounts. Reply to Accounts@8xtel.com with any questions. Invoice ${esc(d.invoice_number)} · ${esc(d.period_from)} to ${esc(d.period_to)} · ${fmt(d.grand_total, d.currency)}</div>
</div>
</body></html>`;
}
