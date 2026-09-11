import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, statusColor } from '../api';

interface Client {
  id: string; name: string; company_name: string | null; system_id: string;
  status: string; balance: string; credit_limit: string; tps_limit: number; ip_count: string;
}

export default function Clients(): JSX.Element {
  const [clients, setClients] = useState<Client[]>([]);
  const [q, setQ] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', system_id: '', allowed_ips: '' });
  const [created, setCreated] = useState<{ system_id: string; password: string; host: string; port: number } | null>(null);

  const load = (): void => {
    api<{ clients: Client[] }>(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => setClients(r.clients)).catch(() => undefined);
  };
  useEffect(load, []);

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const r = await api<{ credentials: { system_id: string; password: string; host: string; port: number } }>('/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        system_id: form.system_id,
        status: 'active',
        allowed_ips: form.allowed_ips.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    });
    setCreated(r.credentials);
    setShow(false);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        <button className="btn" onClick={() => setShow(true)}>+ Add client</button>
      </div>
      <input className="input max-w-sm" placeholder="Search name / system_id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
      {created && (
        <div className="card border-brand">
          <div className="font-medium text-brand mb-2">SMPP credentials — copy now (shown once)</div>
          <pre className="text-sm bg-ink p-3 rounded">
            Host: {created.host}{'\n'}Port: {created.port}{'\n'}System ID: {created.system_id}{'\n'}Password: {created.password}
          </pre>
          <button className="btn-ghost mt-2" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="tbl w-full">
          <thead><tr><th>Name</th><th>System ID</th><th>Status</th><th>Balance</th><th>Credit</th><th>TPS</th><th>IPs</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-line/40">
                <td><Link className="text-brand hover:underline" to={`/clients/${c.id}`}>{c.name}</Link>
                  <div className="text-xs text-gray-500">{c.company_name ?? ''}</div></td>
                <td className="font-mono">{c.system_id}</td>
                <td><span className={`badge ${statusColor(c.status)}`}>{c.status}</span></td>
                <td>${Number(c.balance).toFixed(2)}</td>
                <td>${Number(c.credit_limit).toFixed(2)}</td>
                <td>{c.tps_limit}</td>
                <td>{c.ip_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <form onSubmit={create} className="card w-96 space-y-3">
            <div className="font-bold">New client</div>
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input" placeholder="system_id (e.g. client_001)" value={form.system_id} onChange={(e) => setForm({ ...form, system_id: e.target.value })} required />
            <input className="input" placeholder="Allowed IPs, comma separated" value={form.allowed_ips} onChange={(e) => setForm({ ...form, allowed_ips: e.target.value })} />
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
