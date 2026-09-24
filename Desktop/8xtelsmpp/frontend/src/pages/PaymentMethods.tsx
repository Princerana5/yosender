import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, Modal } from '../components';

interface Method { id: string; kind: string; label: string; chain: string | null; details: Record<string, unknown>; is_active: boolean; sort_order: number }

export default function PaymentMethods(): JSX.Element {
  const [rows, setRows] = useState<Method[]>([]);
  const [editing, setEditing] = useState<Method | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ kind: 'usdt' as string, label: '', chain: 'TRC20' as string, address: '', upi_id: '', account_number: '', bank_name: '', ifsc: '' });

  const load = (): void => { api<{ methods: Method[] }>('/payment-methods').then(r => setRows(r.methods)).catch(() => undefined); };
  useEffect(load, []);

  const submit = async (): Promise<void> => {
    setMsg('');
    let details: Record<string, unknown> = {};
    if (form.kind === 'usdt') details = { address: form.address, chain: form.chain };
    else if (form.kind === 'upi') details = { upi_id: form.upi_id };
    else details = { account_number: form.account_number, bank_name: form.bank_name, ifsc: form.ifsc };
    try {
      if (editing) await api(`/payment-methods/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ label: form.label, chain: form.kind === 'usdt' ? form.chain : null, details }) });
      else await api('/payment-methods', { method: 'POST', body: JSON.stringify({ kind: form.kind, label: form.label, chain: form.kind === 'usdt' ? form.chain : null, details }) });
      setCreating(false); setEditing(null); load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const openEdit = (m: Method): void => {
    const d = m.details ?? {};
    setEditing(m);
    setForm({
      kind: m.kind, label: m.label, chain: m.chain ?? 'TRC20',
      address: String(d.address ?? d.wallet_address ?? ''),
      upi_id: String(d.upi_id ?? d.vpa ?? ''),
      account_number: String(d.account_number ?? ''),
      bank_name: String(d.bank_name ?? ''),
      ifsc: String(d.ifsc ?? ''),
    });
    setCreating(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Payment methods" sub="Receiving accounts shown on invoices — USDT / Bank / UPI" actions={<button className="btn" onClick={() => { setEditing(null); setForm({ kind: 'usdt', label: '', chain: 'TRC20', address: '', upi_id: '', account_number: '', bank_name: '', ifsc: '' }); setCreating(true); }}>+ Add method</button>} />
      {msg && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{msg}</div>}
      <DataTable keyOf={r => r.id} rows={rows} empty="No payment methods yet." columns={[
        { key: 'label', label: 'Label' },
        { key: 'kind', label: 'Kind', render: r => <span className="text-xs uppercase font-semibold">{String(r.kind)}</span> },
        { key: 'chain', label: 'Chain', render: r => <span className="text-xs">{r.chain ?? '—'}</span> },
        { key: 'details', label: 'Details', render: r => { const d = r.details as Record<string, unknown>; const v = String(d.address ?? d.wallet_address ?? d.upi_id ?? d.vpa ?? d.account_number ?? ''); return <span className="text-xs font-mono truncate max-w-[220px] inline-block">{v ? (v.length > 22 ? v.slice(0,22)+'…' : v) : '—'}</span>; } },
        { key: 'is_active', label: 'Active', render: r => <span className={`text-xs ${r.is_active ? 'text-emerald-400' : 'text-red-400'}`}>{r.is_active ? 'Yes' : 'No'}</span> },
        { key: 'actions', label: '', render: r => <span className="flex gap-1"><button className="btn-ghost !py-1 !text-xs" onClick={() => openEdit(r as unknown as Method)}>Edit</button><button className="btn-ghost !py-1 !text-xs" onClick={async () => { await api(`/payment-methods/${(r as unknown as Method).id}`, { method: 'DELETE' }); load(); }}>{(r as unknown as Method).is_active ? 'Disable' : '—'}</button></span> },
      ]} />
      {creating && (
        <Modal title={editing ? 'Edit method' : 'Add method'} onClose={() => setCreating(false)}>
          <div className="space-y-3">
            {msg && <div className="text-sm text-red-300 bg-danger/10 border px-3 py-2 rounded-lg">{msg}</div>}
            <label className="label">Kind *</label>
            <select className="input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              <option value="usdt">USDT (crypto)</option>
              <option value="bank">Bank</option>
              <option value="upi">UPI</option>
            </select>
            <label className="label">Label *</label>
            <input className="input" placeholder="e.g. USDT TRC20" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
            {form.kind === 'usdt' && <>
              <label className="label">Chain *</label>
              <select className="input" value={form.chain} onChange={e => setForm({ ...form, chain: e.target.value })}>
                {['TRC20','ERC20','BEP20','Polygon','Other'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="label">USDT address *</label>
              <input className="input font-mono text-xs" placeholder="T..." value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </>}
            {form.kind === 'upi' && <>
              <label className="label">UPI ID *</label>
              <input className="input font-mono" placeholder="name@bank" value={form.upi_id} onChange={e => setForm({ ...form, upi_id: e.target.value })} />
            </>}
            {form.kind === 'bank' && <>
              <label className="label">Bank name *</label><input className="input" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
              <label className="label">Account number *</label><input className="input font-mono" value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} />
              <label className="label">IFSC / SWIFT</label><input className="input" value={form.ifsc} onChange={e => setForm({ ...form, ifsc: e.target.value })} />
            </>}
            <button className="btn w-full" disabled={!form.label || (form.kind==='usdt' && !form.address) || (form.kind==='upi' && !form.upi_id) || (form.kind==='bank' && (!form.account_number || !form.bank_name))} onClick={submit}>{editing ? 'Save' : 'Create'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
