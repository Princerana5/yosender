import { useEffect, useState } from 'react';
import { api, statusColor } from '../api';

interface Vendor {
  id: string; name: string; host: string; port: number; system_id: string;
  status: string; tps: number;
  connections: Array<{ status: string; messages_sent: string; messages_received: string; last_error: string | null }> | null;
}

export default function Vendors(): JSX.Element {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', host: '', port: '2775', system_id: '', password: '' });

  const load = (): void => {
    api<{ vendors: Vendor[] }>('/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await api('/vendors', {
      method: 'POST',
      body: JSON.stringify({ ...form, port: Number(form.port), status: 'enabled' }),
    });
    setShow(false);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Vendors</h1>
        <button className="btn" onClick={() => setShow(true)}>+ Add vendor</button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {vendors.map((v) => (
          <div key={v.id} className="card">
            <div className="flex items-center justify-between">
              <div className="font-bold">{v.name}</div>
              <span className={`badge ${statusColor(v.connections?.[0]?.status ?? v.status)}`}>
                {(v.connections?.[0]?.status ?? v.status).toUpperCase()}
              </span>
            </div>
            <div className="text-sm text-gray-400 font-mono mt-1">{v.host}:{v.port} · {v.system_id} · {v.tps} TPS</div>
            <div className="text-sm mt-2">
              Sent {v.connections?.reduce((s, c) => s + Number(c.messages_sent), 0) ?? 0} ·
              Recv {v.connections?.reduce((s, c) => s + Number(c.messages_received), 0) ?? 0}
            </div>
            {v.connections?.[0]?.last_error && (
              <div className="text-xs text-red-400 mt-1">{v.connections[0].last_error}</div>
            )}
          </div>
        ))}
        {!vendors.length && <div className="text-gray-500">No vendors yet.</div>}
      </div>
      {show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <form onSubmit={create} className="card w-96 space-y-3">
            <div className="font-bold">New vendor</div>
            {(['name', 'host', 'port', 'system_id', 'password'] as const).map((k) => (
              <input key={k} className="input" placeholder={k} type={k === 'password' ? 'password' : 'text'}
                value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required />
            ))}
            <div className="flex gap-2">
              <button className="btn flex-1" type="submit">Create</button>
              <button className="btn-ghost" type="button" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
