import { useEffect, useState } from 'react';
import { api, fmtMoney } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal } from '../components';

interface Invoice {
  id: string; invoice_number: string; client_id: string; client_name?: string; system_id?: string;
  period_from: string; period_to: string; currency: string;
  subtotal: string; tax_rate: string; tax_amount: string; adjustments: string; grand_total: string;
  status: string; notes: string | null; created_at: string;
}
interface Line {
  country_name: string; iso_code: string | null; total_sms: number; successful: number; failed: number;
  segments: number; rate: string; amount: string; percentage: string;
}
interface DetailState {
  invoice: Invoice; lines: Line[]; payments?: Array<Record<string, unknown>>; payment_methods?: Array<Record<string, unknown>>;
}

export default function Invoices(): JSX.Element {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [filter, setFilter] = useState({ client_id: '', status: '' });
  const [gen, setGen] = useState(false);
  const [form, setForm] = useState({ client_id: '', from: new Date().toISOString().slice(0, 10).slice(0, 7) + '-01', to: new Date().toISOString().slice(0, 10), tax_rate: '0', adjustments: '0', notes: '' });
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [msg, setMsg] = useState('');
  const [payForm, setPayForm] = useState({ method: 'usdt', chain: 'TRC20', reference: '' });

  const load = (): void => {
    const p = new URLSearchParams();
    if (filter.client_id) p.set('client_id', filter.client_id);
    if (filter.status) p.set('status', filter.status);
    api<{ invoices: Invoice[] }>(`/invoices?${p}`).then((r) => setRows(r.invoices)).catch(() => undefined);
  };
  useEffect(() => {
    api<{ clients: Array<{ id: string; name: string }> }>('/clients').then((r) => setClients(r.clients)).catch(() => undefined);
  }, []);
  useEffect(load, [filter]);

  async function doGenerate(): Promise<void> {
    setMsg('');
    try {
      await api('/invoices/generate', { method: 'POST', body: JSON.stringify({ client_id: form.client_id, from: form.from, to: form.to, tax_rate: Number(form.tax_rate), adjustments: Number(form.adjustments), notes: form.notes || null }) });
      setGen(false);
      load();
    } catch (e) { setMsg((e as Error).message); }
  }

  async function openDetail(id: string): Promise<void> {
    const r = await api<DetailState>(`/invoices/${id}`);
    setDetail(r);
  }
  async function reloadDetail(): Promise<void> {
    if (!detail) return;
    const r = await api<DetailState>(`/invoices/${detail.invoice.id}`);
    setDetail(r);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" sub="Period billing — country breakdown, totals, PDF & email" actions={<button className="btn" onClick={() => setGen(true)}>+ Generate invoice</button>} />
      {msg && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{msg}</div>}
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
          { key: 'actions', label: '', render: (r) => <span className="flex gap-1"><button className="btn-ghost !py-1 !text-xs" onClick={() => void openDetail(String(r.id))}>View</button><a className="btn-ghost !py-1 !text-xs" href={`/api/invoices/${String(r.id)}/pdf`} target="_blank" rel="noreferrer">PDF</a></span> },
        ]}
      />
      {gen && (
        <Modal title="Generate invoice" onClose={() => setGen(false)}>
          <div className="space-y-3">
            {msg && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{msg}</div>}
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
      {detail && (
        <Modal title={detail.invoice.invoice_number} onClose={() => setDetail(null)}>
          <div className="space-y-3">
            <div className="flex gap-2 text-xs"><span>{String(detail.invoice.period_from).slice(0, 10)} → {String(detail.invoice.period_to).slice(0, 10)}</span><StatusBadge status={detail.invoice.status} /><span className="ml-auto font-semibold">{fmtMoney(detail.invoice.grand_total, detail.invoice.currency)}</span></div>
            <div className="max-h-48 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-muted"><th className="text-left">Country</th><th className="text-right">SMS</th><th className="text-right">OK</th><th className="text-right">Fail</th><th className="text-right">Amount</th><th className="text-right">%</th></tr></thead>
                <tbody>{detail.lines.map((l, i) => <tr key={i} className="border-t border-line"><td>{l.country_name}</td><td className="text-right">{l.total_sms}</td><td className="text-right text-emerald-300">{l.successful}</td><td className="text-right text-red-300">{l.failed}</td><td className="text-right">{fmtMoney(l.amount, detail.invoice.currency)}</td><td className="text-right">{l.percentage}%</td></tr>)}</tbody>
              </table>
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
            <div className="flex gap-2">
              <a className="btn flex-1 text-center" href={`/api/invoices/${detail.invoice.id}/pdf`} target="_blank" rel="noreferrer">Open PDF</a>
              <button className="btn-ghost" onClick={async () => { await api(`/invoices/${detail.invoice.id}/send`, { method: 'POST', body: JSON.stringify({}) }); setMsg('Email sent'); void reloadDetail(); }}>Send email</button>
              <button className="btn-ghost" onClick={async () => { await api(`/invoices/${detail.invoice.id}/regenerate`, { method: 'POST' }); load(); setDetail(null); }}>Regenerate</button>
            </div>
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
