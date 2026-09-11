import { useEffect, useState } from 'react';
import { api, statusColor, fmtMoney } from '../api';

interface Msg {
  id: string; client_name: string; vendor_name: string | null; source: string;
  destination: string; country_name: string | null; status: string;
  client_price: string | null; vendor_cost: string | null;
  submit_time: string; dlr_time: string | null;
}

export default function Messages(): JSX.Element {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [f, setF] = useState({ destination: '', status: '' });

  const load = (): void => {
    const p = new URLSearchParams();
    if (f.destination) p.set('destination', f.destination);
    if (f.status) p.set('status', f.status);
    api<{ messages: Msg[] }>(`/messages?${p}`).then((r) => setMsgs(r.messages)).catch(() => undefined);
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Message logs</h1>
      <div className="flex gap-2">
        <input className="input max-w-xs" placeholder="Destination…" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select className="input max-w-[200px]" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All statuses</option>
          {['submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="btn" onClick={load}>Filter</button>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="tbl w-full">
          <thead><tr><th>ID</th><th>Client</th><th>Vendor</th><th>From → To</th><th>Status</th><th>Price</th><th>Cost</th><th>Submit</th><th>DLR</th></tr></thead>
          <tbody>
            {msgs.map((m) => (
              <tr key={m.id} className="hover:bg-line/40">
                <td className="font-mono text-xs">{m.id.slice(0, 8)}</td>
                <td>{m.client_name}</td>
                <td>{m.vendor_name ?? '—'}</td>
                <td className="font-mono text-xs">{m.source} → {m.destination}</td>
                <td><span className={`badge ${statusColor(m.status)}`}>{m.status}</span></td>
                <td>{fmtMoney(m.client_price)}</td>
                <td>{fmtMoney(m.vendor_cost)}</td>
                <td className="text-xs">{new Date(m.submit_time).toLocaleString()}</td>
                <td className="text-xs">{m.dlr_time ? new Date(m.dlr_time).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
