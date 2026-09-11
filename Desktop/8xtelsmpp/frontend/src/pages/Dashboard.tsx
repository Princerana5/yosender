import { useEffect, useState } from 'react';
import { api, fmtMoney } from '../api';

interface Dash {
  today: number; month: number; submitted: number; delivered: number;
  undelivered: number; expired: number; rejected: number; failed: number;
  delivery_pct: number; active_clients: number; active_vendors: number;
  active_connections: number; revenue: number; cost: number; profit: number;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div className="card">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-2xl font-bold ${accent ? 'text-brand' : ''}`}>{value}</div>
    </div>
  );
}

export default function Dashboard(): JSX.Element {
  const [d, setD] = useState<Dash | null>(null);
  const [hourly, setHourly] = useState<Array<{ hour: string; total: string; delivered: string }>>([]);

  useEffect(() => {
    api<{ hourly: [] }>('/reports/traffic/hourly').then((r) => setHourly(r.hourly)).catch(() => undefined);
    const load = (): void => {
      api<Dash>('/reports/dashboard').then(setD).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  if (!d) return <div className="text-gray-400">Loading…</div>;
  const max = Math.max(1, ...hourly.map((h) => Number(h.total)));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label="SMS today" value={String(d.today)} />
        <Stat label="SMS this month" value={String(d.month)} />
        <Stat label="Submitted" value={String(d.submitted)} />
        <Stat label="Delivered" value={String(d.delivered)} />
        <Stat label="Undelivered" value={String(d.undelivered)} />
        <Stat label="Expired" value={String(d.expired)} />
        <Stat label="Rejected" value={String(d.rejected)} />
        <Stat label="Failed" value={String(d.failed)} />
        <Stat label="Delivery %" value={`${d.delivery_pct}%`} accent />
        <Stat label="Active clients" value={String(d.active_clients)} />
        <Stat label="Active vendors" value={String(d.active_vendors)} />
        <Stat label="SMPP connections" value={String(d.active_connections)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Revenue (today)" value={fmtMoney(d.revenue)} accent />
        <Stat label="Vendor cost" value={fmtMoney(d.cost)} />
        <Stat label="Profit" value={fmtMoney(d.profit)} accent />
      </div>
      <div className="card">
        <div className="text-sm font-medium mb-3">Hourly traffic (24h)</div>
        <div className="flex items-end gap-1 h-32">
          {hourly.map((h) => (
            <div key={h.hour} className="flex-1 flex flex-col justify-end" title={`${h.hour}: ${h.total}`}>
              <div className="bg-brand rounded-t" style={{ height: `${(Number(h.total) / max) * 100}%`, minHeight: 2 }} />
            </div>
          ))}
          {!hourly.length && <div className="text-sm text-gray-500">No traffic yet</div>}
        </div>
      </div>
    </div>
  );
}
