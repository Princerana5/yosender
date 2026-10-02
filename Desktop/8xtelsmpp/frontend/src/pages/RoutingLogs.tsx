import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge } from '../components';

export function RoutingLogs(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [vendor, setVendor] = useState('');
  const load = (): void => {
    api<{ logs: Record<string, unknown>[] }>(`/routes/logs/routing?limit=200${vendor ? `&vendor_id=${vendor}` : ''}`)
      .then((r) => setRows(r.logs)).catch(() => undefined);
  };
  useEffect(load, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Routing logs" sub="Full trace — who, where, which chain, pricing, margin, health" />
      <div className="card card-pad flex gap-2">
        <input className="input !w-64 font-mono text-xs" placeholder="filter vendor_id" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      <DataTable keyOf={(r) => String(r.id)} rows={rows} empty="No routing logs yet." columns={[
        { key: 'created_at', label: 'Time', render: (r) => <span className="text-xs text-muted">{r.created_at ? new Date(String(r.created_at)).toLocaleString() : '—'}</span> },
        { key: 'route_code', label: 'Route', mono: true, render: (r) => String(r.route_code ?? r.route_name ?? '—') },
        { key: 'destination', label: 'Dest', mono: true },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'traffic_mode', label: 'Mode', mono: true },
        { key: 'price_per_segment', label: 'Price', right: true, render: (r) => r.price_per_segment != null ? String(r.price_per_segment) : '—' },
        { key: 'margin', label: 'Margin', right: true, render: (r) => r.margin != null ? String(r.margin) : '—' },
        { key: 'vendor_chain', label: 'Chain', render: (r) => {
          const c = r.vendor_chain as Array<{ name: string }> | null;
          return <span className="text-xs">{Array.isArray(c) ? c.map((x) => x.name).join(' → ') : '—'}</span>;
        } },
      ]} />
    </div>
  );
}

export function FailoverLogs(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const load = (): void => { api<{ logs: Record<string, unknown>[] }>('/routes/logs/failover?limit=200').then((r) => setRows(r.logs)).catch(() => undefined); };
  useEffect(load, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Failover logs" sub="Every hop — reason, latency, attempt" />
      <div className="card card-pad"><button className="btn" onClick={load}>Refresh</button></div>
      <DataTable keyOf={(r) => String(r.id)} rows={rows} empty="No failovers." columns={[
        { key: 'created_at', label: 'Time', render: (r) => <span className="text-xs text-muted">{r.created_at ? new Date(String(r.created_at)).toLocaleString() : '—'}</span> },
        { key: 'route_name', label: 'Route' },
        { key: 'reason', label: 'Reason' },
        { key: 'attempt', label: 'Try', mono: true },
        { key: 'success', label: 'OK', render: (r) => <StatusBadge status={r.success ? 'delivered' : r.success === false ? 'failed' : 'unknown'} /> },
      ]} />
    </div>
  );
}

export function RouteHealthPage(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const load = (): void => { api<{ health: Record<string, unknown>[] }>('/routes/health/all').then((r) => setRows(r.health)).catch(() => undefined); };
  useEffect(load, []);
  const stateColor = (s: string) => s === 'HEALTHY' ? 'text-emerald-400' : s === 'DEGRADED' ? 'text-amber-400' : s === 'OPEN' ? 'text-red-400' : 'text-sky-400';
  return (
    <div className="space-y-4">
      <PageHeader title="Route health" sub="Circuit breaker · HEALTHY / DEGRADED / OPEN / RECOVERING" />
      <div className="card card-pad flex gap-2">
        <button className="btn" onClick={load}>Refresh</button>
        <button className="btn-ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          // refresh first route as sample — full refresh is per-route
          const list = await api<{ routes: Array<{ id: string }> }>('/routes').catch(() => ({ routes: [] }));
          for (const r of (list.routes ?? []).slice(0, 5)) await api(`/routes/${r.id}/health/refresh`, { method: 'POST' }).catch(() => undefined);
          load(); setBusy(false);
        }}>{busy ? 'Refreshing…' : 'Recompute (24h)'}</button>
      </div>
      <DataTable keyOf={(r) => String(r.route_id) + String(r.vendor_id)} rows={rows} empty="No health rows yet — send traffic or hit Recompute." columns={[
        { key: 'route_code', label: 'Route', mono: true, render: (r) => String(r.route_code ?? r.route_name ?? '—') },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'circuit_state', label: 'State', render: (r) => <span className={`text-xs font-bold ${stateColor(String(r.circuit_state))}`}>{String(r.circuit_state)}</span> },
        { key: 'availability_pct', label: 'Avail %', right: true, render: (r) => r.availability_pct != null ? String(r.availability_pct) : '—' },
        { key: 'dlr_success_pct', label: 'DLR %', right: true, render: (r) => r.dlr_success_pct != null ? String(r.dlr_success_pct) : '—' },
        { key: 'avg_response_ms', label: 'Avg ms', right: true, mono: true },
        { key: 'total_sends', label: 'Sends', right: true },
      ]} />
    </div>
  );
}

export function RoutingRulesPage(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState({ name: '', prefix: '', country_id: '', traffic_mode: 'priority' });
  const [countries, setCountries] = useState<Array<{ id: string; name: string }>>([]);
  const load = (): void => { api<{ rules: Record<string, unknown>[] }>('/routes/rules/all').then((r) => setRows(r.rules)).catch(() => undefined); };
  useEffect(() => { load(); api<{ countries: typeof countries }>('/system/countries').then((r) => setCountries(r.countries)).catch(() => undefined); }, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Routing rules" sub="Country / prefix / MCC-MNC / sender / type / source / time → route" />
      <div className="card card-pad space-y-3">
        <div className="text-sm font-semibold">New rule</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.country_id} onChange={(e) => setForm({ ...form, country_id: e.target.value })}><option value="">Any country</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input className="input font-mono text-xs" placeholder="prefix e.g. 91" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
          <select className="input" value={form.traffic_mode} onChange={(e) => setForm({ ...form, traffic_mode: e.target.value })}>
            {['priority','weighted','least_cost','best_quality','round_robin','failover_only'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <button className="btn" disabled={!form.name.trim()} onClick={async () => {
          await api('/routes/rules', { method: 'POST', body: JSON.stringify({ name: form.name, country_id: form.country_id || null, prefix: form.prefix || null, traffic_mode: form.traffic_mode, enabled: true, priority: 100 }) });
          setForm({ name: '', prefix: '', country_id: '', traffic_mode: 'priority' }); load();
        }}>Add rule</button>
      </div>
      <DataTable keyOf={(r) => String(r.id)} rows={rows} empty="No rules." columns={[
        { key: 'name', label: 'Name' },
        { key: 'country_name', label: 'Country' },
        { key: 'prefix', label: 'Prefix', mono: true },
        { key: 'traffic_mode', label: 'Mode', mono: true },
        { key: 'priority', label: 'Prio', mono: true },
        { key: 'enabled', label: 'On', render: (r) => <StatusBadge status={r.enabled ? 'delivered' : 'failed'} /> },
        { key: '_act', label: '', render: (r) => <button className="btn-ghost text-xs" onClick={async () => { await api(`/routes/rules/${String(r.id)}`, { method: 'DELETE' }); load(); }}>Delete</button> },
      ]} />
    </div>
  );
}
