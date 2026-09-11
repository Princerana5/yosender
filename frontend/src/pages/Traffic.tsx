import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Icon } from '../components';

interface FlowRow {
  client_id: string; client_name: string; system_id: string;
  country_id: string | null; country_name: string | null; iso_code: string | null;
  vendor_id: string | null; vendor_name: string | null;
  total: string; delivered: string; failed: string; pending: string; last_at: string;
}

interface RecentMsg {
  id: string; created_at: string; source: string; destination: string; status: string;
  client_name: string; country_name: string | null; iso_code: string | null;
  vendor_name: string | null; route_name: string | null;
}

interface Opt {
  id: string;
  name: string;
  system_id?: string;
}

export default function Traffic(): JSX.Element {
  const [flow, setFlow] = useState<FlowRow[]>([]);
  const [recent, setRecent] = useState<RecentMsg[]>([]);
  const [mpm, setMpm] = useState(0);
  const [clients, setClients] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);
  const [countries, setCountries] = useState<Opt[]>([]);
  const [f, setF] = useState({ client_id: '', country_id: '', vendor_id: '', minutes: '15' });
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    api<{ clients: Opt[] }>('/clients').then((r) => setClients(r.clients)).catch(() => undefined);
    api<{ vendors: Opt[] }>('/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
    api<{ countries: Opt[] }>('/system/countries').then((r) => setCountries(r.countries)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let dead = false;
    const load = (): void => {
      if (paused) return;
      const p = new URLSearchParams({ minutes: f.minutes });
      if (f.client_id) p.set('client_id', f.client_id);
      if (f.country_id) p.set('country_id', f.country_id);
      if (f.vendor_id) p.set('vendor_id', f.vendor_id);
      api<{ flow: FlowRow[]; recent: RecentMsg[]; msgs_per_min: number }>(`/reports/live?${p}`)
        .then((r) => {
          if (dead) return;
          setFlow(r.flow);
          setRecent(r.recent);
          setMpm(r.msgs_per_min);
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [f, paused]);

  const totals = flow.reduce(
    (s, r) => ({ total: s.total + Number(r.total), delivered: s.delivered + Number(r.delivered) }),
    { total: 0, delivered: 0 },
  );
  const pct = totals.total ? ((totals.delivered / totals.total) * 100).toFixed(1) : '—';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Live traffic"
        sub="Who is sending what, to which country, through which vendor"
        actions={
          <span className="flex items-center gap-2">
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setPaused((p) => !p)}>
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <span className="flex items-center gap-2 text-xs text-muted border border-line rounded-lg px-3 py-1.5 bg-panel">
              <span className="relative flex w-2 h-2">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${paused ? 'bg-gray-400' : 'bg-emerald-400 animate-ping'}`} />
                <span className={`relative inline-flex rounded-full w-2 h-2 ${paused ? 'bg-gray-400' : 'bg-emerald-400'}`} />
              </span>
              {paused ? 'PAUSED' : 'LIVE · 3s'}
            </span>
          </span>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="stat-card"><div className="stat-label">Msgs / min</div><div className="stat-value text-emerald-300 tabular-nums">{mpm}</div></div>
        <div className="stat-card"><div className="stat-label">In window</div><div className="stat-value tabular-nums">{totals.total.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Delivered</div><div className="stat-value text-emerald-300 tabular-nums">{totals.delivered.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Delivery %</div><div className="stat-value tabular-nums">{pct}{pct === '—' ? '' : '%'}</div></div>
      </div>

      {/* filters */}
      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="w-52">
          <label className="label">Client</label>
          <select className="input" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Country</label>
          <select className="input" value={f.country_id} onChange={(e) => setF({ ...f, country_id: e.target.value })}>
            <option value="">All countries</option>
            {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Vendor</label>
          <select className="input" value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}>
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="w-32">
          <label className="label">Window</label>
          <select className="input" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })}>
            {['5', '15', '60', '240'].map((m) => <option key={m} value={m}>Last {m}m</option>)}
          </select>
        </div>
        {(f.client_id || f.country_id || f.vendor_id) && (
          <button className="btn-ghost" onClick={() => setF({ ...f, client_id: '', country_id: '', vendor_id: '' })}>Clear</button>
        )}
      </div>

      {/* flow table */}
      <div>
        <div className="card-title mb-2 px-1">Flow — client → country → vendor</div>
        <DataTable
          keyOf={(r, i) => `${r.client_id}-${r.country_id}-${r.vendor_id}-${i}`}
          rows={flow}
          empty="No traffic in this window for the selected filters."
          columns={[
            {
              key: 'client', label: 'Client',
              render: (r) => <div><div className="font-semibold">{r.client_name}</div><div className="text-[11px] text-muted font-mono">{r.system_id}</div></div>,
            },
            {
              key: 'country', label: 'Country',
              render: (r) => r.country_name
                ? <span><span className="font-mono text-[11px] bg-panel2 border border-line rounded px-1.5 py-0.5 mr-1.5">{r.iso_code}</span>{r.country_name}</span>
                : <span className="text-muted">unresolved</span>,
            },
            {
              key: 'vendor', label: 'Vendor →',
              render: (r) => r.vendor_name ?? <span className="text-muted">— (no route)</span>,
            },
            { key: 'total', label: 'Msgs', right: true, render: (r) => <span className="tabular-nums font-semibold">{Number(r.total).toLocaleString()}</span> },
            { key: 'delivered', label: 'Delivered', right: true, render: (r) => <span className="tabular-nums text-emerald-300">{Number(r.delivered).toLocaleString()}</span> },
            { key: 'failed', label: 'Failed', right: true, render: (r) => <span className={`tabular-nums ${Number(r.failed) ? 'text-red-300' : 'text-muted'}`}>{Number(r.failed).toLocaleString()}</span> },
            { key: 'pending', label: 'Pending', right: true, render: (r) => <span className="tabular-nums text-sky-300">{Number(r.pending).toLocaleString()}</span> },
          ]}
        />
      </div>

      {/* live feed */}
      <div>
        <div className="card-title mb-2 px-1">Live feed <span className="text-muted font-normal">· newest first</span></div>
        <DataTable
          keyOf={(r) => r.id}
          rows={recent}
          empty="Nothing yet — messages appear here in real time."
          columns={[
            {
              key: 'created_at', label: 'Time',
              render: (r) => <span className="text-xs text-muted font-mono whitespace-nowrap">{new Date(r.created_at).toLocaleTimeString()}</span>,
            },
            { key: 'client_name', label: 'Client' },
            {
              key: 'route', label: 'From → To', mono: true,
              render: (r) => <span>{r.source} <span className="text-muted">→</span> {r.destination}</span>,
            },
            { key: 'country_name', label: 'Country', render: (r) => r.country_name ?? <span className="text-muted">…</span> },
            { key: 'vendor_name', label: 'Vendor', render: (r) => r.vendor_name ?? <span className="text-muted">…</span> },
            { key: 'route_name', label: 'Route', render: (r) => <span className="text-xs text-muted">{r.route_name ?? '—'}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted">
        <Icon name="bolt" size={12} />
        Tip: pick a client above to watch only their traffic, country by country.
      </div>
    </div>
  );
}
