import { useEffect, useState } from 'react';
import { api } from '../api';

interface Route {
  id: string; name: string; channel: string; strategy: string; status: string;
  vendors: Array<{ vendor_id: string; priority: number; weight: number }> | null;
}

export default function Routes(): JSX.Element {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', prefix: '', strategy: 'priority' });

  const load = (): void => {
    api<{ routes: Route[] }>('/routes').then((r) => setRoutes(r.routes)).catch(() => undefined);
  };
  useEffect(load, []);

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await api('/routes', { method: 'POST', body: JSON.stringify({ ...form, prefix: form.prefix || null }) });
    setShow(false);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Routes & failover</h1>
        <button className="btn" onClick={() => setShow(true)}>+ Add route</button>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="tbl w-full">
          <thead><tr><th>Name</th><th>Channel</th><th>Strategy</th><th>Status</th><th>Vendor chain</th></tr></thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.channel}</td>
                <td className="font-mono text-xs">{r.strategy}</td>
                <td>{r.status}</td>
                <td className="text-xs">{r.vendors?.map((v) => `P${v.priority} ${v.weight}%`).join(' → ') ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <form onSubmit={create} className="card w-96 space-y-3">
            <div className="font-bold">New route</div>
            <input className="input" placeholder="Name (e.g. India Premium)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input" placeholder="Prefix (e.g. 91, blank = any)" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
            <select className="input" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
              {['priority', 'failover', 'round_robin', 'least_cost', 'percentage'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
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
