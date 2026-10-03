import { useEffect, useMemo, useState } from 'react';
import { api, fmtMoney } from '../api';
import { PageHeader, StatCard, Donut, Bars, StatusBadge, Icon } from '../components';

interface Dash {
  today: number; month: number; submitted: number; delivered: number;
  undelivered: number; expired: number; rejected: number; failed: number;
  delivery_pct: number; active_clients: number; active_vendors: number;
  active_connections: number; revenue: number; cost: number; profit: number;
  margin_pct?: number; period?: { from: string; to: string; messages: number };
}
interface Hour { hour: string; total: string; delivered: string; }

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

export default function Dashboard(): JSX.Element {
  const [d, setD] = useState<Dash | null>(null);
  const [hourly, setHourly] = useState<Hour[]>([]);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());

  useEffect(() => {
    let dead = false;
    api<{ hourly: Hour[] }>('/reports/traffic/hourly').then((r) => !dead && setHourly(r.hourly)).catch(() => undefined);
    const load = (): void => {
      const qs = `?from=${from}&to=${to}`;
      api<Dash>(`/reports/dashboard${qs}`).then((r) => !dead && setD(r)).catch((e) => !dead && setErr((e as Error).message));
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { dead = true; clearInterval(t); };
  }, [from, to]);

  const spark = useMemo(() => hourly.map((h) => Number(h.total)), [hourly]);
  const bars = useMemo(() => hourly.map((h) => ({ label: new Date(h.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), total: Number(h.total), ok: Number(h.delivered) })), [hourly]);

  if (err) return <div className="card card-pad text-center py-16"><div className="font-semibold">Couldn't reach the API</div><div className="text-sm text-muted mt-1">{err}</div></div>;
  if (!d) return <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="card card-pad animate-pulse"><div className="h-3 w-20 bg-line rounded" /><div className="h-7 w-24 bg-line rounded mt-2" /></div>)}</div>;

  const periodLabel = from === to ? from : `${from} → ${to}`;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Network overview"
        sub="Live view of traffic, delivery and margin across all clients and vendors."
        actions={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs border border-line rounded-lg px-2 py-1 bg-panel">
              <input type="date" className="bg-transparent text-xs outline-none" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-muted">→</span>
              <input type="date" className="bg-transparent text-xs outline-none" value={to} onChange={(e) => setTo(e.target.value)} />
            </span>
            <span className="flex items-center gap-2 text-xs text-muted border border-line rounded-lg px-3 py-1.5 bg-panel">
              <span className="relative flex w-2 h-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-400" /></span>
              Auto-refresh · 10s
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard label="SMS today" value={d.today.toLocaleString()} spark={spark} />
        <StatCard label="SMS this month" value={d.month.toLocaleString()} />
        <StatCard label="Delivery rate" value={`${d.delivery_pct}%`} tone={d.delivery_pct >= 90 ? 'brand' : 'warn'} sub={`${d.delivered.toLocaleString()} delivered`} />
        <StatCard label="Active clients" value={String(d.active_clients)} />
        <StatCard label="Active vendors" value={String(d.active_vendors)} />
        <StatCard label="SMPP binds" value={String(d.active_connections)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label={`Revenue · ${periodLabel}`} value={fmtMoney(d.revenue)} tone="brand" sub={`${(d.period?.messages ?? d.today).toLocaleString()} msgs in period · selling rate × segments`} />
        <StatCard label={`Vendor cost · ${periodLabel}`} value={fmtMoney(d.cost)} sub="vendor rate × segments (from vendor_rates / route cost)" />
        <StatCard label={`Margin · ${periodLabel}`} value={fmtMoney(d.profit)} tone={d.profit >= 0 ? 'brand' : 'warn'} sub={d.revenue ? `${(d.margin_pct ?? (d.profit / d.revenue * 100)).toFixed(1)}% · revenue − vendor cost` : 'No traffic in period'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="card card-pad xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div><div className="card-title">Hourly throughput</div><div className="card-sub">Submitted messages · last 24 hours</div></div>
            <span className="badge bg-brand/10 text-emerald-300 border border-brand/20 tabular-nums">{d.today.toLocaleString()} today</span>
          </div>
          <Bars data={bars} />
        </div>
        <div className="card card-pad">
          <div className="card-title">Delivery mix</div><div className="card-sub">Terminal outcomes · this month</div>
          <div className="mt-4"><Donut center={`${d.delivery_pct}%`} slices={[{ value: d.delivered, color: '#10b981', label: 'Delivered' },{ value: d.undelivered, color: '#f59e0b', label: 'Undelivered' },{ value: d.expired, color: '#fb923c', label: 'Expired' },{ value: d.rejected, color: '#ef4444', label: 'Rejected' },{ value: d.failed, color: '#f43f5e', label: 'Failed' }]} /></div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([['Submitted', d.submitted, 'submitted'],['Undelivered', d.undelivered, 'undelivered'],['Rejected', d.rejected, 'rejected'],['Failed', d.failed, 'failed']] as const).map(([label, v, s]) => (
          <div key={label} className="card px-4 py-3 flex items-center justify-between" title={label === 'Rejected' ? 'Rejected — non chargeable (€0.00)' : undefined}>
            <div><div className="stat-label">{label}{label === 'Rejected' ? ' *' : ''}</div><div className="text-xl font-bold tabular-nums mt-0.5">{(v as number).toLocaleString()}</div></div>
            <StatusBadge status={s as string} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted"><Icon name="bolt" size={12} />Revenue = selling rate (route_client_rates → route → client_rates) × segments &nbsp;·&nbsp; Margin = revenue − vendor cost (vendor_rates / internal_vendor_cost × segments).</div>
    </div>
  );
}
