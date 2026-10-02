import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, Icon } from '../components';

const PRESETS: Array<{ label: string; pct: number; interval: number; delay: number }> = [
  { label: '5% / 100 / 5s', pct: 5, interval: 100, delay: 5 },
  { label: '10% / 100 / 10s', pct: 10, interval: 100, delay: 10 },
  { label: '10% / 500 / 10s', pct: 10, interval: 500, delay: 10 },
  { label: '20% / 100 / 15s', pct: 20, interval: 100, delay: 15 },
];

interface Config {
  id: string; enabled: boolean; percentage: string; interval_messages: number; delay_seconds: number;
  selection_mode: string; scope: string; status: string; client_id: string | null; route_id: string | null; country_id: string | null;
  route_name?: string | null; client_name?: string | null; country_name?: string | null;
  messages_processed?: string; messages_selected?: string; dlrs_received?: string; dlrs_delayed?: string; dlrs_released?: string; currently_queued?: string; avg_delay_ms?: number | null;
}
interface Stat { messages_processed: number; messages_selected: number; selection_pct: number; dlrs_received: number; dlrs_delayed: number; dlrs_released: number; currently_queued: number; failed_jobs: number; }

function CuttingForm({ initial, onSaved, onCancel }: {
  initial?: Partial<Config>; onSaved: () => void; onCancel: () => void;
}): JSX.Element {
  const [enabled, setEnabled] = useState(!!initial?.enabled);
  const [pct, setPct] = useState(String(Number(initial?.percentage ?? 10)));
  const [interval, setInterval] = useState(String(initial?.interval_messages ?? 100));
  const [delay, setDelay] = useState(String(initial?.delay_seconds ?? 10));
  const [mode, setMode] = useState(initial?.selection_mode ?? 'sequential');
  const [scope, setScope] = useState(initial?.scope ?? 'route');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [clientId, setClientId] = useState(initial?.client_id ?? '');
  const [routeId, setRouteId] = useState(initial?.route_id ?? '');
  const [countryId, setCountryId] = useState(initial?.country_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [routes, setRoutes] = useState<Array<{ id: string; name: string }>>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    api<{ clients: Array<{ id: string; name: string }> }>('/clients').then(r => setClients(r.clients)).catch(() => undefined);
    api<{ routes: Array<{ id: string; name: string }> }>('/routes').then(r => setRoutes(r.routes)).catch(() => undefined);
    api<{ countries: Array<{ id: string; name: string }> }>('/system/countries').then(r => setCountries(r.countries)).catch(() => undefined);
  }, []);
  const summary = `${Number(pct) || 0}% of eligible messages will be selected every ${Number(interval) || 0} messages, and their legitimate DLRs will be delayed by ${Number(delay) || 0} seconds.`;
  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true); setErr('');
    const body: Record<string, unknown> = {
      enabled, percentage: Number(pct), interval_messages: Number(interval), delay_seconds: Number(delay),
      selection_mode: mode, scope, status,
      client_id: scope === 'client' || (scope === 'country' && routeId) ? (clientId || null) : scope === 'global' ? null : (clientId || null),
      route_id: scope === 'route' || scope === 'country' ? (routeId || null) : null,
      country_id: scope === 'country' ? (countryId || null) : null,
    };
    // For scope=country with route+country, route_id is the route, country_id is country
    // For scope=route alone, country_id stays null. The form handles both via selects.
    if (scope === 'country') {
      body.country_id = countryId || null;
      // if user picked a route for country-scoped, keep it; else route_id stays null
      body.route_id = routeId || null;
    }
    try {
      if (initial?.id) await api(`/dlr-cutting/configs/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/dlr-cutting/configs', { method: 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-lg border border-line bg-ink/60 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Enable DLR Cutting</span>
          <button type="button" onClick={() => setEnabled(v => !v)}
            className={`ml-auto rounded-full px-4 py-1 text-xs font-bold border ${enabled ? 'bg-brand/20 text-emerald-300 border-brand/40' : 'bg-panel2 text-muted border-line'}`}>
            {enabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Cutting Percentage (%)</label>
            <input className="input" type="number" min={0} max={100} step={0.5} value={pct} onChange={e => setPct(e.target.value)} required /></div>
          <div><label className="label">Cut After Every (messages)</label>
            <input className="input" type="number" min={1} value={interval} onChange={e => setInterval(e.target.value)} required /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Delay Time (seconds)</label>
            <input className="input" type="number" min={0} max={86400} value={delay} onChange={e => setDelay(e.target.value)} required /></div>
          <div><label className="label">Selection Mode</label>
            <select className="input" value={mode} onChange={e => setMode(e.target.value as never)}>
              <option value="sequential">Sequential — first in interval delivered, last cut</option>
              <option value="random">Random</option>
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Apply To</label>
            <select className="input" value={scope} onChange={e => setScope(e.target.value)}>
              <option value="global">Global</option><option value="route">Route</option><option value="client">Client</option><option value="country">Country</option>
            </select></div>
          <div><label className="label">Status</label>
            <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="active">Active</option><option value="disabled">Disabled</option>
            </select></div>
        </div>
        {scope === 'client' && (
          <div><label className="label">Client</label>
            <select className="input" value={clientId} onChange={e => setClientId(e.target.value)} required>
              <option value="">— select client —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        )}
        {(scope === 'route') && (
          <div><label className="label">Route</label>
            <select className="input" value={routeId} onChange={e => setRouteId(e.target.value)} required>
              <option value="">— select route —</option>{routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
        )}
        {scope === 'country' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Route (optional — for route+country)</label>
              <select className="input" value={routeId} onChange={e => setRouteId(e.target.value)}>
                <option value="">— any route (country-only) —</option>{routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></div>
            <div><label className="label">Country</label>
              <select className="input" value={countryId} onChange={e => setCountryId(e.target.value)} required>
                <option value="">— select country —</option>{countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
        )}
        <div className="rounded border border-brand/30 bg-brand/5 px-3 py-2 text-xs"> {summary} </div>
        <div className="flex gap-2">
          <span className="text-[11px] text-muted">Presets:</span>
          {PRESETS.map(p => (
            <button key={p.label} type="button" className="text-[11px] px-2 py-1 rounded border border-line hover:border-brand/40"
              onClick={() => { setPct(String(p.pct)); setInterval(String(p.interval)); setDelay(String(p.delay)); }}>
              {p.label}
            </button>
          ))}
        </div>
        {err && <div className="text-xs text-red-300 border border-danger/30 bg-danger/10 rounded px-3 py-2">{err}</div>}
      </div>
      <div className="flex gap-2">
        <button className="btn flex-1" type="submit" disabled={busy}>{busy ? 'Saving…' : (initial?.id ? 'Save Configuration' : 'Create Configuration')}</button>
        <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// -- Route-scoped inline panel for Routes detail drawer
export function RouteDlrCuttingPanel({ routeId }: { routeId: string }): JSX.Element {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [stats, setStats] = useState<Stat | null>(null);
  const [detail, setDetail] = useState<{ config: Config; interval_remaining: number | null; interval_position: number } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Config | null>(null);
  const mine = configs.filter(c => c.route_id === routeId);
  const load = (): void => {
    api<{ configs: Config[] }>('/dlr-cutting/configs').then(r => setConfigs(r.configs)).catch(() => undefined);
    api<{ stats: Stat }>('/dlr-cutting/stats').then(r => setStats(r.stats)).catch(() => undefined);
    if (mine[0]) api<{ config: Config; interval_remaining: number | null; interval_position: number }>(`/dlr-cutting/configs/${mine[0].id}`).then(r => setDetail(r as never)).catch(() => undefined);
  };
  useEffect(load, [routeId]);
  const active = mine.find(c => c.enabled && c.status === 'active');
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted">DLR delay</h4>
        {active ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">{Number(active.percentage).toFixed(0)}% / {active.interval_messages} / {active.delay_seconds}s · ON</span>
          : <span className="text-[11px] px-2 py-0.5 rounded-full bg-ink text-muted border border-line">Off</span>}
        <button className="ml-auto text-xs font-medium border border-line rounded-full px-3 py-1 hover:border-brand/30" onClick={() => { setEditing(active ?? null); setShowForm(true); }}>
          {active ? 'Edit' : 'Configure'}
        </button>
      </div>
      {active && (
        <p className="text-xs text-muted leading-relaxed">
          {Number(active.percentage).toFixed(0)}% every {active.interval_messages} msgs · delay {active.delay_seconds}s
          {detail && detail.interval_remaining !== null ? ` · ${detail.interval_remaining} left in interval` : ''}
          {stats ? ` · ${Number(stats.selection_pct ?? 0).toFixed(1)}% selected` : ''}
        </p>
      )}
      {!active && <p className="text-xs text-muted">Delay legitimate DLRs — no fabrication, no status rewrite.</p>}
      {stats && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ['Processed', stats.messages_processed],
            ['Selected', stats.messages_selected],
            ['Queued', stats.currently_queued],
            ['Released', stats.dlrs_released],
          ].map(([l, n]) => (
            <div key={l as string} className="rounded-lg bg-ink/30 border border-line/40 py-2">
              <div className="font-semibold tabular-nums text-xs">{Number(n).toLocaleString()}</div>
              <div className="text-[10px] tracking-widest uppercase text-muted">{l}</div>
            </div>
          ))}
        </div>
      )}
      {mine.length > 1 && (
        <p className="text-[11px] text-amber-300">Multiple configs match — most specific active one applies.</p>
      )}
      {showForm && (
        <CuttingForm
          initial={editing ?? { scope: 'route', route_id: routeId, percentage: '10', interval_messages: 100, delay_seconds: 10, enabled: true, status: 'active' } as unknown as Partial<Config>}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

export default function DlrCuttingAdmin(): JSX.Element {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [stats, setStats] = useState<Stat | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Config | null>(null);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [tab, setTab] = useState<'configs' | 'logs' | 'queue'>('configs');
  const [health, setHealth] = useState<{ queued: number; failed: number; released: number; overdue: number } | null>(null);
  const [logFilter, setLogFilter] = useState({ queue_status: '', original_status: '' });

  const load = (): void => {
    api<{ configs: Config[] }>('/dlr-cutting/configs').then(r => setConfigs(r.configs)).catch(() => undefined);
    api<{ stats: Stat }>('/dlr-cutting/stats').then(r => setStats(r.stats)).catch(() => undefined);
    api<{ logs: Record<string, unknown>[]; total: number }>(`/dlr-cutting/logs?limit=50${logFilter.queue_status ? `&queue_status=${logFilter.queue_status}` : ''}${logFilter.original_status ? `&original_status=${logFilter.original_status}` : ''}`)
      .then(r => { setLogs(r.logs); setLogTotal(r.total); }).catch(() => undefined);
    api<{ queued: number; failed: number; released: number; overdue: number }>('/dlr-cutting/queue/health').then(r => setHealth(r)).catch(() => undefined);
  };
  useEffect(load, []);
  useEffect(load, [logFilter]);

  async function del(id: string): Promise<void> {
    if (!window.confirm('Delete this DLR cutting config?')) return;
    await api(`/dlr-cutting/configs/${id}`, { method: 'DELETE' });
    load();
  }
  async function retryFailed(): Promise<void> {
    await api('/dlr-cutting/queue/retry-failed', { method: 'POST' });
    load();
  }

  return (
    <div className="space-y-5">
      <PageHeader title="DLR Cutting / Delay Control" sub="Delay legitimate vendor DLRs — never fabricates, never rewrites status" actions={<button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}><Icon name="plus" size={14} /> Add config</button>} />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            ['Messages Processed', stats.messages_processed],
            ['Messages Selected', stats.messages_selected],
            ['Selection %', `${stats.selection_pct.toFixed(2)}%`],
            ['DLRs Received', stats.dlrs_received],
            ['DLRs Delayed', stats.dlrs_delayed],
            ['DLRs Released', stats.dlrs_released],
            ['Currently Queued', stats.currently_queued],
            ['Failed Jobs', stats.failed_jobs],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-ink/60 border border-line/60 py-3 text-center">
              <div className="font-bold tabular-nums">{typeof v === 'number' ? v.toLocaleString() : String(v)}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted">{l}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        {(['configs', 'logs', 'queue'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${tab === t ? 'border-brand/50 text-emerald-300 bg-brand/10' : 'border-line text-muted'}`}>{t === 'configs' ? 'Configurations' : t === 'logs' ? `Logs (${logTotal})` : 'Queue Health'}</button>
        ))}
      </div>

      {showForm && (
        <Modal title={editing ? 'Edit DLR Cutting Config' : 'New DLR Cutting Config'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <CuttingForm initial={editing ?? undefined} onSaved={() => { setShowForm(false); setEditing(null); load(); }} onCancel={() => { setShowForm(false); setEditing(null); }} />
        </Modal>
      )}

      {tab === 'configs' && (
        configs.length ? (
          <DataTable keyOf={r => r.id} rows={configs} columns={[
            { key: 'scope', label: 'Scope', render: r => <span className="badge border border-line text-[11px]">{r.scope}{r.route_name ? ` · ${r.route_name}` : ''}{r.client_name ? ` · ${r.client_name}` : ''}{r.country_name ? ` · ${r.country_name}` : ''}</span> },
            { key: 'enabled', label: 'Enabled', render: r => <StatusBadge status={r.enabled && r.status === 'active' ? 'active' : 'disabled'} /> },
            { key: 'percentage', label: '%', render: r => <span className="font-mono text-xs">{Number(r.percentage).toFixed(1)}%</span> },
            { key: 'interval_messages', label: 'Interval' },
            { key: 'delay_seconds', label: 'Delay', render: r => <span>{r.delay_seconds}s</span> },
            { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> },
            { key: 'actions', label: '', render: r => (
              <span className="flex gap-1 justify-end">
                <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>
                <button className="btn-ghost !px-2 !py-1 !text-xs text-red-300" onClick={() => del(r.id)}><Icon name="trash" size={12} /></button>
              </span>
            ) },
          ]} />
        ) : <div className="card card-pad text-center text-sm text-muted py-8">No DLR cutting configs yet. Create one scoped to a route, client, country, or globally.</div>
      )}

      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <select className="input !py-1 !text-xs w-auto" value={logFilter.queue_status} onChange={e => setLogFilter({ ...logFilter, queue_status: e.target.value })}>
              <option value="">All queue statuses</option><option value="queued">Queued</option><option value="released">Released</option><option value="failed">Failed</option>
            </select>
            <select className="input !py-1 !text-xs w-auto" value={logFilter.original_status} onChange={e => setLogFilter({ ...logFilter, original_status: e.target.value })}>
              <option value="">All DLR statuses</option><option value="delivered">DELIVERED</option><option value="undelivered">UNDELIVERED</option><option value="expired">EXPIRED</option><option value="rejected">REJECTED</option>
            </select>
            <a className="btn-ghost !py-1 !text-xs" href={`/api/dlr-cutting/logs/export`} target="_blank" rel="noreferrer">Export CSV</a>
          </div>
          <DataTable keyOf={(r: Record<string, unknown>) => String(r.id)} rows={logs as never} columns={[
            { key: 'message_id', label: 'Message ID', mono: true, render: r => <span className="font-mono text-[11px]">{String((r as Record<string, unknown>).message_id).slice(0, 12)}</span> },
            { key: 'client_name', label: 'Client' },
            { key: 'route_name', label: 'Route' },
            { key: 'original_status', label: 'Original DLR', render: r => <StatusBadge status={String((r as Record<string, unknown>).original_status)} /> },
            { key: 'selected', label: 'Selected', render: r => String((r as Record<string, unknown>).selected) === 'true' ? 'YES' : 'NO' },
            { key: 'delay_seconds', label: 'Delay', render: r => <span>{String((r as Record<string, unknown>).delay_seconds)}s</span> },
            { key: 'received_at', label: 'Received', render: r => <span className="text-xs text-muted">{(r as Record<string, unknown>).received_at ? new Date(String((r as Record<string, unknown>).received_at)).toLocaleString() : '—'}</span> },
            { key: 'released_at', label: 'Released', render: r => {
              const v = (r as Record<string, unknown>).released_at;
              return <span className="text-xs text-muted">{v ? new Date(String(v)).toLocaleString() : '—'}</span>;
            } },
            { key: 'queue_status', label: 'Queue', render: r => <StatusBadge status={String((r as Record<string, unknown>).queue_status)} /> },
          ]} />
        </div>
      )}

      {tab === 'queue' && (
        <div className="space-y-3">
          {health && (
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ['Queued', health.queued],
                ['Failed', health.failed],
                ['Released', health.released],
                ['Overdue', health.overdue],
              ].map(([l, n]) => (
                <div key={l as string} className={`rounded-lg border py-3 ${l === 'Failed' && Number(n) > 0 ? 'bg-danger/10 border-danger/30' : l === 'Overdue' && Number(n) > 0 ? 'bg-warn/10 border-warn/30' : 'bg-ink/60 border-line/60'}`}>
                  <div className="font-bold tabular-nums">{Number(n).toLocaleString()}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">{l}</div>
                </div>
              ))}
            </div>
          )}
          {health && health.failed > 0 && (
            <button className="btn !border-warn/40" onClick={retryFailed}>Retry {health.failed} failed job(s)</button>
          )}
          <div className="text-xs text-muted">Queued DLRs survive restarts (persisted in Postgres). The worker drains overdue jobs on boot. Delay uses BullMQ delayed jobs + DB as source of truth.</div>
        </div>
      )}
    </div>
  );
}
