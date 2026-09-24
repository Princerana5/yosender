import { useEffect, useState } from 'react';
import { api, token, fmtMoney, API_BASE } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, Icon } from '../components';

interface Invoice {
  id: string; invoice_number: string; client_id: string; client_name?: string; system_id?: string;
  period_from: string; period_to: string; currency: string;
  subtotal: string; tax_rate: string; tax_amount: string; adjustments: string; grand_total: string;
  status: string; notes: string | null; created_at: string;
}
interface Line {
  country_name: string; iso_code: string | null; total_sms: number; successful: number; failed: number; rejected: number;
  segments: number; rate: string; amount: string; percentage: string;
}
interface DetailState {
  invoice: Invoice; lines: Line[]; emails?: Array<Record<string, unknown>>; payments?: Array<Record<string, unknown>>; payment_methods?: Array<Record<string, unknown>>;
}

async function downloadPdf(id: string, invoiceNumber: string): Promise<void> {
  const t = token();
  const base = (API_BASE || '').replace(/\/$/, '');
  const url = `${base}/invoices/${id}/pdf`;
  // Always request PDF (not HTML fallback) — backend respects ?format=pdf
  const res = await fetch(url, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `PDF failed ${res.status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  const isPdf = ct.includes('pdf');
  // Validate: if we expected PDF but got HTML/JSON, the edge proxy routed wrong
  if (!isPdf) {
    const text = await res.clone().text().catch(() => '');
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('PDF route returned HTML — check nginx /api proxy (expected /api/invoices/:id/pdf)');
    }
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(new Blob([blob], { type: isPdf ? 'application/pdf' : 'text/html' }));
  if (isPdf) window.open(blobUrl, '_blank');
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = isPdf ? `Invoice_${invoiceNumber}.pdf` : `Invoice_${invoiceNumber}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export default function Invoices(): JSX.Element {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string; portal_email?: string | null }>>([]);
  const [filter, setFilter] = useState({ client_id: '', status: '' });
  const [gen, setGen] = useState(false);
  const [form, setForm] = useState({ client_id: '', from: new Date().toISOString().slice(0, 10).slice(0, 7) + '-01', to: new Date().toISOString().slice(0, 10), tax_rate: '0', adjustments: '0', notes: '' });
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [msg, setMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [payForm, setPayForm] = useState({ method: 'usdt', chain: 'TRC20', reference: '' });
  // edit invoice
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [editForm, setEditForm] = useState({ tax_rate: '0', adjustments: '0', notes: '', status: '' });
  // send mail
  const [sendFor, setSendFor] = useState<Invoice | null>(null);
  const [mail, setMail] = useState({ to: '', cc: '', bcc: '', subject: '', intro: '' });
  const [sending, setSending] = useState(false);
  const [showTemplateHelp, setShowTemplateHelp] = useState(false);

  const load = (): void => {
    const p = new URLSearchParams();
    if (filter.client_id) p.set('client_id', filter.client_id);
    if (filter.status) p.set('status', filter.status);
    api<{ invoices: Invoice[] }>(`/invoices?${p}`).then((r) => setRows(r.invoices)).catch(() => undefined);
  };
  useEffect(() => {
    api<{ clients: Array<{ id: string; name: string; portal_email?: string | null }> }>('/clients').then((r) => setClients(r.clients)).catch(() => undefined);
  }, []);
  useEffect(load, [filter]);

  async function doGenerate(): Promise<void> {
    setMsg(''); setErrMsg('');
    try {
      await api('/invoices/generate', { method: 'POST', body: JSON.stringify({ client_id: form.client_id, from: form.from, to: form.to, tax_rate: Number(form.tax_rate), adjustments: Number(form.adjustments), notes: form.notes || null }) });
      setGen(false);
      load();
      setMsg('Invoice generated');
    } catch (e) { setErrMsg((e as Error).message); }
  }

  async function openDetail(id: string): Promise<void> {
    try {
      const r = await api<DetailState>(`/invoices/${id}`);
      setDetail(r);
    } catch (e) { setErrMsg((e as Error).message); }
  }
  async function reloadDetail(): Promise<void> {
    if (!detail) return;
    const r = await api<DetailState>(`/invoices/${detail.invoice.id}`);
    setDetail(r);
  }

  function startEdit(inv: Invoice): void {
    setEditing(inv);
    setEditForm({ tax_rate: String(inv.tax_rate ?? '0'), adjustments: String(inv.adjustments ?? '0'), notes: inv.notes ?? '', status: inv.status });
  }
  async function doEdit(): Promise<void> {
    if (!editing) return;
    setErrMsg('');
    try {
      const body: Record<string, unknown> = {};
      if (editForm.tax_rate !== String(editing.tax_rate)) body.tax_rate = Number(editForm.tax_rate);
      if (editForm.adjustments !== String(editing.adjustments)) body.adjustments = Number(editForm.adjustments);
      if ((editForm.notes ?? '') !== (editing.notes ?? '')) body.notes = editForm.notes || null;
      if (editForm.status !== editing.status) body.status = editForm.status;
      if (!Object.keys(body).length) { setEditing(null); return; }
      await api(`/invoices/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditing(null);
      setMsg('Invoice updated');
      load();
      if (detail?.invoice.id === editing.id) await reloadDetail();
    } catch (e) { setErrMsg((e as Error).message); }
  }
  async function doDelete(inv: Invoice): Promise<void> {
    if (!window.confirm(`Delete ${inv.invoice_number} (${inv.status})? This cannot be undone. Paid/sent invoices must be cancelled first.`)) return;
    try {
      await api(`/invoices/${inv.id}`, { method: 'DELETE' });
      setMsg(`${inv.invoice_number} deleted`);
      if (detail?.invoice.id === inv.id) setDetail(null);
      load();
    } catch (e) { setErrMsg((e as Error).message); }
  }
  async function doDownloadPdf(inv: Invoice): Promise<void> {
    setErrMsg('');
    try { await downloadPdf(inv.id, inv.invoice_number); }
    catch (e) { setErrMsg((e as Error).message); }
  }
  function openSend(inv: Invoice): void {
    setSendFor(inv);
    const client = clients.find(c => c.id === inv.client_id);
    const fallback = (client?.portal_email ?? '') as string;
    setMail({ to: fallback, cc: '', bcc: '', subject: `Invoice ${inv.invoice_number} — ${String(inv.period_from).slice(0, 10)} to ${String(inv.period_to).slice(0, 10)} — 8xtel`, intro: '' });
    setErrMsg('');
  }
  async function doSend(): Promise<void> {
    if (!sendFor) return;
    const toList = mail.to.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (!toList.length) { setErrMsg('Enter at least one recipient (To)'); return; }
    const ccList = mail.cc.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const bccList = mail.bcc.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    setSending(true); setErrMsg('');
    try {
      const r = await api<{ error?: string | null; message_id?: string | null; emailed_to?: string }>(`/invoices/${sendFor.id}/send`, {
        method: 'POST',
        body: JSON.stringify({
          to_emails: toList,
          cc: ccList.length ? ccList : undefined,
          bcc: bccList.length ? bccList : undefined,
          subject: mail.subject.trim() || undefined,
          intro: mail.intro.trim() || undefined,
        }),
      });
      if (r.error) { setErrMsg(`Mail failed: ${r.error}`); }
      else { setMsg(`Invoice sent to ${toList.join(', ')}${r.message_id ? ` · ${r.message_id}` : ''}`); setSendFor(null); load(); if (detail?.invoice.id === sendFor.id) await reloadDetail(); }
    } catch (e) { setErrMsg((e as Error).message); }
    finally { setSending(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" sub="Period billing — country breakdown, totals, PDF & email" actions={<button className="btn" onClick={() => setGen(true)}>+ Generate invoice</button>} />
      {msg && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">{msg}</div>}
      {errMsg && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{errMsg}</div>}
      <div className="card card-pad flex flex-wrap gap-2">
        <select className="input max-w-xs" value={filter.client_id} onChange={(e) => setFilter({ ...filter, client_id: e.target.value })}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input max-w-[180px]" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All statuses</option>
          {['draft', 'generated', 'sent', 'paid', 'overdue', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <DataTable
        keyOf={(r) => r.id}
        rows={rows}
        empty="No invoices yet — generate one for a period."
        columns={[
          { key: 'invoice_number', label: 'Invoice', mono: true },
          { key: 'client_name', label: 'Client' },
          { key: 'period_from', label: 'Period', render: (r) => <span className="text-xs">{String(r.period_from).slice(0, 10)} → {String(r.period_to).slice(0, 10)}</span> },
          { key: 'grand_total', label: 'Total', right: true, render: (r) => <span className="font-semibold">{fmtMoney(r.grand_total, r.currency)}</span> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
          {
            key: 'actions', label: '', render: (r) => (
              <span className="flex gap-1 flex-wrap">
                <button className="btn-ghost !py-1 !text-xs" onClick={() => void openDetail(String(r.id))}>View</button>
                <button className="btn-ghost !py-1 !text-xs" onClick={() => void doDownloadPdf(r as Invoice)}>PDF</button>
                <button className="btn-ghost !py-1 !text-xs" onClick={() => startEdit(r as Invoice)}>Edit</button>
                <button className="btn-ghost !py-1 !text-xs" onClick={() => openSend(r as Invoice)}>Email</button>
                <button className="btn-ghost !py-1 !text-xs text-red-300/80 hover:text-red-200" onClick={() => void doDelete(r as Invoice)} title="Delete (draft/generated only)">Delete</button>
              </span>
            ),
          },
        ]}
      />
      {gen && (
        <Modal title="Generate invoice" onClose={() => setGen(false)}>
          <div className="space-y-3">
            {errMsg && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{errMsg}</div>}
            <label className="label">Client *</label>
            <select className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">— Select —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">From</label><input type="date" className="input" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></div>
              <div><label className="label">To</label><input type="date" className="input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Tax %</label><input className="input" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} /></div>
              <div><label className="label">Adjustments</label><input className="input" value={form.adjustments} onChange={(e) => setForm({ ...form, adjustments: e.target.value })} /></div>
            </div>
            <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <button className="btn w-full" disabled={!form.client_id || !form.from || !form.to} onClick={() => void doGenerate()}>Generate</button>
          </div>
        </Modal>
      )}
      {/* Edit invoice */}
      {editing && (
        <Modal title={`Edit ${editing.invoice_number}`} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            {errMsg && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{errMsg}</div>}
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Tax %</label><input className="input" value={editForm.tax_rate} onChange={(e) => setEditForm({ ...editForm, tax_rate: e.target.value })} placeholder="0" /></div>
              <div><label className="label">Adjustments</label><input className="input" value={editForm.adjustments} onChange={(e) => setEditForm({ ...editForm, adjustments: e.target.value })} placeholder="0" /></div>
            </div>
            <div><label className="label">Status</label>
              <select className="input" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                {['draft','generated','sent','paid','unpaid','overdue','cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="text-[11px] text-muted mt-1">Tax/adjustments cannot be edited once paid or cancelled.</p>
            </div>
            <div><label className="label">Notes</label><textarea className="input" rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Optional notes shown on PDF & email" /></div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={() => void doEdit()}>Save</button>
              <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {/* Send mail */}
      {sendFor && (
        <Modal title={`Send ${sendFor.invoice_number}`} onClose={() => setSendFor(null)}>
          <div className="space-y-3">
            {errMsg && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{errMsg}</div>}
            <div><label className="label">To * <span className="text-muted font-normal">(comma separated)</span></label>
              <input className="input" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="client@company.com, finance@company.com" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">CC</label><input className="input" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} placeholder="cc@company.com" /></div>
              <div><label className="label">BCC</label><input className="input" value={mail.bcc} onChange={(e) => setMail({ ...mail, bcc: e.target.value })} placeholder="bcc@company.com" /></div>
            </div>
            <div><label className="label">Subject</label>
              <input className="input" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} placeholder={`Invoice ${sendFor.invoice_number} — ...`} />
              <p className="text-[11px] text-muted mt-1">Leave blank to use default. Supports plain text.</p>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <label className="label !mb-0">Intro / template override</label>
                <button type="button" className="text-[11px] text-brand hover:underline" onClick={() => setShowTemplateHelp(v => !v)}>{showTemplateHelp ? 'Hide help' : 'Template help'}</button>
              </div>
              <textarea className="input mt-1" rows={3} value={mail.intro} onChange={(e) => setMail({ ...mail, intro: e.target.value })} placeholder="Custom paragraph above the summary table. HTML allowed (e.g. <b>). Leave blank for default." />
              {showTemplateHelp && (
                <div className="text-[11px] text-muted mt-1 leading-relaxed">
                  Default intro: <em>Please find your invoice for {'{{period_from}}'} → {'{{period_to}}'} attached as PDF. Summary below:</em><br />
                  PDF attached automatically as <code>Invoice_{'{invoice_number}'}.pdf</code>. Use Payment Methods to edit the How to pay block on the PDF/email.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" disabled={sending} onClick={() => void doSend()}>{sending ? 'Sending…' : 'Send email'}</button>
              <button className="btn-ghost" onClick={() => setSendFor(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.invoice.invoice_number} onClose={() => setDetail(null)}>
          <div className="space-y-3">
            <div className="flex gap-2 text-xs"><span>{String(detail.invoice.period_from).slice(0, 10)} → {String(detail.invoice.period_to).slice(0, 10)}</span><StatusBadge status={detail.invoice.status} /><span className="ml-auto font-semibold">{fmtMoney(detail.invoice.grand_total, detail.invoice.currency)}</span></div>
            <div className="max-h-48 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-muted"><th className="text-left">Country</th><th className="text-right">SMS</th><th className="text-right">OK</th><th className="text-right">Fail</th><th className="text-right" title="non chargeable">Rejected *</th><th className="text-right">Amount</th><th className="text-right">%</th></tr></thead>
                <tbody>{detail.lines.map((l, i) => <tr key={i} className="border-t border-line"><td>{l.country_name}</td><td className="text-right">{l.total_sms}</td><td className="text-right text-emerald-300">{l.successful}</td><td className="text-right text-red-300">{l.failed}</td><td className="text-right text-red-300/80" title="non chargeable">{Number((l as unknown as { rejected?: number }).rejected ?? 0).toLocaleString()}</td><td className="text-right">{fmtMoney(l.amount, detail.invoice.currency)}</td><td className="text-right">{l.percentage}%</td></tr>)}</tbody>
              </table>
              {detail.lines.some(l => Number((l as unknown as { rejected?: number }).rejected ?? 0) > 0) && <div className="text-[11px] text-muted">* Rejected SMS — non chargeable (€0.00)</div>}
            </div>
            {!!detail.payment_methods?.length && (
              <div className="card card-pad !p-3">
                <div className="text-[10px] tracking-widest uppercase text-muted font-semibold mb-2">How to pay</div>
                {detail.payment_methods.map((m) => {
                  const d = (typeof m.details === 'string' ? JSON.parse(m.details as string) : m.details) as Record<string, unknown> ?? {};
                  const val = String(d.address ?? d.wallet_address ?? d.upi_id ?? d.vpa ?? d.account_number ?? '');
                  return <div key={String(m.id)} className="text-xs border border-line rounded-lg px-2 py-1.5 mb-1 bg-panel/50"><b>{String(m.label)}</b> <span className="text-muted">— {String(m.kind).toUpperCase()}{m.chain ? ` · ${String(m.chain)}` : ''}</span><div className="font-mono text-[11px] break-all">{val || '—'}</div></div>;
                })}
              </div>
            )}
            {detail.invoice.notes && <div className="text-xs border border-amber-500/30 bg-amber-500/10 rounded-lg px-3 py-2"><b className="text-amber-300">Notes:</b> <span className="whitespace-pre-wrap">{detail.invoice.notes}</span></div>}
            <div className="flex flex-wrap gap-2">
              <button className="btn flex-1" onClick={() => void doDownloadPdf(detail.invoice)}>Download PDF</button>
              <button className="btn-ghost" onClick={() => openSend(detail.invoice)}>Send email</button>
              <button className="btn-ghost" onClick={() => startEdit(detail.invoice)}>Edit</button>
              <button className="btn-ghost" onClick={async () => { await api(`/invoices/${detail.invoice.id}/regenerate`, { method: 'POST' }); load(); setDetail(null); }}>Regenerate</button>
            </div>
            {!!detail.emails?.length && (
              <div className="text-[11px] text-muted">Last send: {String((detail.emails[0] as Record<string,unknown>).to_email ?? '')} · {String((detail.emails[0] as Record<string,unknown>).sent_at ?? '').slice(0, 19).replace('T',' ')} {(detail.emails[0] as Record<string,unknown>).error ? `· failed: ${String((detail.emails[0] as Record<string,unknown>).error).slice(0,120)}` : `· ${String((detail.emails[0] as Record<string,unknown>).message_id ?? '').slice(0,40)}`}</div>
            )}
            <div className="border-t border-line pt-3">
              <div className="text-[11px] font-semibold mb-2">Payments {detail.payments?.length ? `(${detail.payments.length})` : ''}</div>
              {!!detail.payments?.length && (
                <div className="space-y-1 max-h-32 overflow-auto mb-2">
                  {detail.payments.map((pp) => (
                    <div key={String(pp.id)} className="flex items-center gap-2 text-xs border border-line rounded px-2 py-1">
                      <span className="font-mono">{String(pp.method).toUpperCase()}{pp.chain ? ` ${String(pp.chain)}` : ''}</span>
                      <StatusBadge status={String(pp.status)} />
                      <span className="ml-auto flex gap-1">
                        {String(pp.status) === 'pending' && <>
                          <button className="btn-ghost !py-0 !px-2 !text-xs" onClick={async () => { await api(`/invoices/${detail.invoice.id}/payment/${String(pp.id)}/verify`, { method: 'POST', body: JSON.stringify({ action: 'verify' }) }); await reloadDetail(); load(); }}>Verify</button>
                          <button className="btn-ghost !py-0 !px-2 !text-xs" onClick={async () => { await api(`/invoices/${detail.invoice.id}/payment/${String(pp.id)}/verify`, { method: 'POST', body: JSON.stringify({ action: 'reject' }) }); await reloadDetail(); }}>Reject</button>
                        </>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1 items-end">
                <select className="input !py-1 text-xs max-w-[110px]" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}><option value="usdt">USDT</option><option value="bank">Bank</option><option value="upi">UPI</option><option value="wire">Wire</option><option value="other">Other</option></select>
                {payForm.method === 'usdt' && <select className="input !py-1 text-xs max-w-[110px]" value={payForm.chain} onChange={(e) => setPayForm({ ...payForm, chain: e.target.value })}>{['TRC20','ERC20','BEP20','Polygon','Other'].map((c) => <option key={c} value={c}>{c}</option>)}</select>}
                <input className="input !py-1 text-xs flex-1 min-w-[120px]" placeholder={payForm.method === 'usdt' ? 'TX hash' : 'Reference / UTR'} value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
                <button className="btn !py-1 !text-xs" onClick={async () => { await api(`/invoices/${detail.invoice.id}/payment`, { method: 'POST', body: JSON.stringify({ method: payForm.method, chain: payForm.method === 'usdt' ? payForm.chain : null, details: payForm.reference ? { reference: payForm.reference, tx_hash: payForm.reference } : {}, reference: payForm.reference || undefined }) }); setPayForm({ ...payForm, reference: '' }); await reloadDetail(); load(); }}>Add</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
