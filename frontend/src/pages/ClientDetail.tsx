import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, statusColor } from '../api';

export default function ClientDetail(): JSX.Element {
  const { id } = useParams();
  const [data, setData] = useState<{ client: Record<string, string>; ips: Array<{ id: string; ip: string; enabled: boolean }>; rates: Array<Record<string, string>> } | null>(null);
  const [ip, setIp] = useState('');

  const load = (): void => {
    api<NonNullable<typeof data>>(`/clients/${id}`).then(setData).catch(() => undefined);
  };
  useEffect(load, [id]);

  async function patch(body: object): Promise<void> {
    await api(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    load();
  }
  async function addIp(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await api(`/clients/${id}/ips`, { method: 'POST', body: JSON.stringify({ ip }) });
    setIp('');
    load();
  }
  async function rotate(): Promise<void> {
    const r = await api<{ password: string }>(`/clients/${id}/rotate-password`, { method: 'POST' });
    alert(`New password (copy now): ${r.password}`);
  }

  if (!data) return <div className="text-gray-400">Loading…</div>;
  const c = data.client;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{c.name} <span className="font-mono text-base text-gray-400">{c.system_id}</span></h1>
      <div className="card flex flex-wrap gap-3 items-center">
        <span className={`badge ${statusColor(c.status)}`}>{c.status}</span>
        <span className="text-sm">Balance ${Number(c.balance).toFixed(2)} · Credit ${Number(c.credit_limit).toFixed(2)} · TPS {c.tps_limit}</span>
        <div className="flex gap-2 ml-auto">
          {['active', 'suspended', 'blocked'].map((s) => (
            <button key={s} className="btn-ghost" onClick={() => patch({ status: s })}>{s}</button>
          ))}
          <button className="btn-ghost" onClick={rotate}>Rotate password</button>
        </div>
      </div>
      <div className="card">
        <div className="font-medium mb-2">IP whitelist</div>
        <form onSubmit={addIp} className="flex gap-2 mb-3">
          <input className="input max-w-xs" placeholder="103.20.10.5 or 103.20.10.0/24" value={ip} onChange={(e) => setIp(e.target.value)} />
          <button className="btn" type="submit">Add</button>
        </form>
        <div className="space-y-1">
          {data.ips.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{i.ip}</span>
              <span className={`badge ${i.enabled ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'}`}>{i.enabled ? 'on' : 'off'}</span>
              <button className="btn-ghost !px-2 !py-0.5" onClick={() => api(`/clients/${id}/ips/${i.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !i.enabled }) }).then(load)}>toggle</button>
              <button className="btn-ghost !px-2 !py-0.5" onClick={() => api(`/clients/${id}/ips/${i.id}`, { method: 'DELETE' }).then(load)}>remove</button>
            </div>
          ))}
          {!data.ips.length && <div className="text-sm text-gray-500">No IPs — any IP allowed (add IPs to restrict).</div>}
        </div>
      </div>
      <div className="card">
        <div className="font-medium mb-2">Client rates</div>
        <table className="tbl w-full">
          <thead><tr><th>Country</th><th>Prefix</th><th>Price</th></tr></thead>
          <tbody>{data.rates.map((r, i) => (
            <tr key={i}><td>{r.country_name ?? '—'}</td><td className="font-mono">{r.prefix ?? '*'}</td><td>${Number(r.price).toFixed(4)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
