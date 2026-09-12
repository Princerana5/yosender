import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Money } from '../components';

interface Msg {
  id: string; client_name: string; vendor_name: string | null; source: string;
  destination: string; country_name: string | null; status: string;
  client_price: string | null; vendor_cost: string | null;
  submit_time: string; dlr_time: string | null;
}

const STATUSES = ['submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'];

export default function Messages(): JSX.Element {
  const [searchParams] = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [f, setF] = useState({ destination: '', status: '', message_id: searchParams.get('message_id') ?? '' });
  const [loading, setLoading] = useState(false);

  const load = (): void => {
    setLoading(true);
    const p = new URLSearchParams();
    if (f.destination) p.set('destination', f.destination);
    if (f.status) p.set('status', f.status);
    if (f.message_id) p.set('message_id', f.message_id);
    api<{ messages: Msg[] }>(`/messages?${p}`)
      .then((r) => setMsgs(r.messages))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="space-y-5">
      <PageHeader title="Message logs" sub="Searchable delivery record · content hidden by default" />

      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="w-64">
          <label className="label">Destination</label>
          <input className="input font-mono" placeholder="9198…" value={f.destination}
            onChange={(e) => setF({ ...f, destination: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div className="w-48">
          <label className="label">Status</label>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="w-64">
          <label className="label">Message ID</label>
          <input className="input font-mono" placeholder="internal / vendor / client id" value={f.message_id}
            onChange={(e) => setF({ ...f, message_id: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Searching…' : 'Apply filters'}</button>
        {(f.destination || f.status || f.message_id) && (
          <button className="btn-ghost" onClick={() => { setF({ destination: '', status: '', message_id: '' }); setTimeout(load, 0); }}>
            Clear
          </button>
        )}
        <div className="ml-auto flex gap-1.5">
          {STATUSES.map((s) => (
            <button key={s}
              onClick={() => { setF({ ...f, status: f.status === s ? '' : s }); setTimeout(load, 0); }}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${f.status === s
                ? 'border-brand/50 text-emerald-300 bg-brand/10'
                : 'border-line text-muted hover:text-white'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        keyOf={(m) => m.id}
        rows={msgs}
        empty="No messages match these filters."
        columns={[
          { key: 'id', label: 'ID', mono: true, render: (m) => m.id.slice(0, 8) },
          { key: 'client_name', label: 'Client' },
          { key: 'vendor_name', label: 'Vendor', render: (m) => m.vendor_name ?? <span className="text-muted">—</span> },
          {
            key: 'destination', label: 'Route', mono: true,
            render: (m) => <span>{m.source} <span className="text-muted">→</span> {m.destination}</span>,
          },
          { key: 'status', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
          { key: 'client_price', label: 'Price', right: true, render: (m) => <Money value={m.client_price} /> },
          { key: 'vendor_cost', label: 'Cost', right: true, render: (m) => <Money value={m.vendor_cost} /> },
          {
            key: 'submit_time', label: 'Submitted',
            render: (m) => <span className="text-xs text-muted whitespace-nowrap">{new Date(m.submit_time).toLocaleString()}</span>,
          },
          {
            key: 'dlr_time', label: 'DLR',
            render: (m) => <span className="text-xs text-muted whitespace-nowrap">{m.dlr_time ? new Date(m.dlr_time).toLocaleString() : '—'}</span>,
          },
        ]}
      />
    </div>
  );
}
