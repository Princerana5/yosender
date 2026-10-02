import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, DataTable } from '../components';

interface VendorSplit { vendor_id: string; vendor_name?: string; vendor_status?: string; priority: number; weight: number; }
interface RouteRow {
  id: string; name: string; route_code: string | null; strategy: string; traffic_mode?: string | null;
  status: string; country_name?: string | null; vendors: VendorSplit[] | null;
}

interface GroupRow { id: string; name: string; description?: string | null; }
interface GroupMember { group_id: string; route_id: string; route_name?: string; route_code?: string | null; weight: number; priority: number; }

function modeLabel(m: string): string {
  const map: Record<string, string> = { weighted: 'Weighted', priority: 'Priority', least_cost: 'Least Cost', best_quality: 'Best Quality', round_robin: 'Round Robin', failover_only: 'Failover Only' };
  return map[m] ?? m;
}
function modeBadge(m: string): string {
  const cls: Record<string, string> = {
    weighted: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    priority: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
    least_cost: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    best_quality: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    round_robin: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    failover_only: 'bg-red-500/15 text-red-300 border-red-500/30',
  };
  return cls[m] ?? 'bg-zinc-500/10 text-muted border-line';
}

function Bar({ splits }: { splits: VendorSplit[] }): JSX.Element {
  const total = splits.reduce((s, v) => s + (v.weight ?? 0), 0);
  const over = total !== 100 && splits.length > 1;
  const palette = ['bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-cyan-500'];
  return (
    <div className="space-y-1">
      <div className="h-2.5 rounded-full overflow-hidden flex bg-ink border border-line/60">
        {splits.length ? splits.sort((a,b)=>a.priority-b.priority).map((v,i) => (
          <div key={v.vendor_id} className={palette[i % palette.length]!} style={{ width: `${Math.max(0, Math.min(100, (v.weight / Math.max(1,total))*100))}%` }} title={`${v.vendor_name ?? v.vendor_id} — ${v.weight}%`} />
        )) : <div className="w-full bg-zinc-800" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {splits.sort((a,b)=>a.priority-b.priority).map((v,i) => (
          <span key={v.vendor_id} className="inline-flex items-center gap-1 text-[11px]">
            <span className={`w-2 h-2 rounded-sm ${palette[i % palette.length]}`} />{v.vendor_name ?? v.vendor_id.slice(0,8)} <span className="font-mono font-bold">{v.weight}%</span> <span className="text-muted">p{v.priority}</span>
          </span>
        ))}
        <span className={`ml-auto text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border ${over ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>
          Σ {total}%{over ? ' — must be 100' : ''}
        </span>
      </div>
    </div>
  );
}

export default function RoutingDistribution(): JSX.Element {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMember[]>>({});
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('all');

  const load = async (): Promise<void> => {
    const r = await api<{ routes: RouteRow[] }>('/routes').catch(() => ({ routes: [] }));
    setRoutes(r.routes ?? []);
    const g = await api<{ groups: GroupRow[] }>('/routes/groups').catch(() => ({ groups: [] }));
    setGroups(g.groups ?? []);
    // fetch members per group
    const m: Record<string, GroupMember[]> = {};
    await Promise.all((g.groups ?? []).map(async (gr) => {
      const mm = await api<{ members: GroupMember[] }>(`/routes/groups/${gr.id}/members`).catch(() => ({ members: [] }));
      m[gr.id] = mm.members ?? [];
    }));
    setMembersByGroup(m);
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    let out = routes;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((r) => `${r.name} ${r.route_code ?? ''} ${r.country_name ?? ''}`.toLowerCase().includes(needle));
    }
    if (mode !== 'all') out = out.filter((r) => (r.traffic_mode ?? r.strategy) === mode);
    return out;
  }, [routes, q, mode]);

  const stats = useMemo(() => {
    const weighted = routes.filter((r) => (r.traffic_mode ?? r.strategy) === 'weighted').length;
    const bad = routes.filter((r) => {
      const v = r.vendors ?? [];
      if (v.length <= 1) return false;
      return v.reduce((s,x)=>s+(x.weight??0),0) !== 100;
    }).length;
    return { total: routes.length, weighted, bad, groups: groups.length };
  }, [routes, groups]);

  return (
    <div className="space-y-5">
      <PageHeader title="Traffic distribution" sub="Per-route vendor split · total must be 100 · group distribution" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card card-pad"><div className="text-[11px] text-muted uppercase tracking-widest">Routes</div><div className="text-2xl font-extrabold">{stats.total}</div></div>
        <div className="card card-pad"><div className="text-[11px] text-muted uppercase tracking-widest">Weighted</div><div className="text-2xl font-extrabold text-sky-300">{stats.weighted}</div></div>
        <div className="card card-pad"><div className="text-[11px] text-muted uppercase tracking-widest">Groups</div><div className="text-2xl font-extrabold">{stats.groups}</div></div>
        <div className={`card card-pad border ${stats.bad ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
          <div className="text-[11px] text-muted uppercase tracking-widest">Invalid splits</div>
          <div className={`text-2xl font-extrabold ${stats.bad ? 'text-red-300' : 'text-emerald-300'}`}>{stats.bad}</div>
          <div className="text-[11px] text-muted">{stats.bad ? 'Σ ≠ 100 — fix weights' : 'All Σ = 100'}</div>
        </div>
      </div>

      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Search</label>
          <input className="input" placeholder="route name / code / country" value={q} onChange={(e)=>setQ(e.target.value)} />
        </div>
        <div>
          <label className="label">Mode</label>
          <select className="input" value={mode} onChange={(e)=>setMode(e.target.value)}>
            <option value="all">All modes</option>
            <option value="weighted">Weighted</option>
            <option value="priority">Priority</option>
            <option value="least_cost">Least Cost</option>
            <option value="best_quality">Best Quality</option>
            <option value="round_robin">Round Robin</option>
            <option value="failover_only">Failover Only</option>
          </select>
        </div>
        <button className="btn" onClick={() => void load()}>Refresh</button>
        <Link to="/routes" className="btn-ghost">Manage routes →</Link>
      </div>

      {/* ── Per-route distribution ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="font-semibold">Per-route vendor distribution</div>
          <div className="text-xs text-muted">{filtered.length} routes</div>
        </div>
        <DataTable
          keyOf={(r)=>r.id}
          rows={filtered}
          empty="No routes."
          columns={[
            { key: 'route_code', label: 'Route', mono: true, render: (r) => (
              <div>
                <div className="font-mono font-bold text-xs">{r.route_code ?? '—'}</div>
                <div className="text-xs">{r.name}</div>
                <div className="text-[11px] text-muted">{r.country_name ?? 'Global'}{r.status !== 'active' ? ` · ${r.status}` : ''}</div>
              </div>
            )},
            { key: 'traffic_mode', label: 'Mode', render: (r) => {
              const m = String(r.traffic_mode ?? r.strategy ?? 'priority');
              return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${modeBadge(m)}`}>{modeLabel(m)}</span>;
            }},
            { key: 'vendors', label: 'Distribution (priority → weight)', render: (r) => {
              const v = (r.vendors ?? []) as VendorSplit[];
              if (!v.length) return <span className="text-xs text-muted">No vendors — add one in Routes</span>;
              return <div className="min-w-[280px]"><Bar splits={v} /></div>;
            }},
          ]}
        />
      </div>

      {/* ── Group distribution ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <div className="font-semibold">Route groups</div>
          <div className="text-xs text-muted">Groups distribute across routes — same Σ=100 guard</div>
        </div>
        {groups.length === 0 ? <div className="p-6 text-sm text-muted">No groups yet. Create one in Routes → Groups.</div> : (
          <div className="divide-y divide-line">
            {groups.map((g) => {
              const ms = membersByGroup[g.id] ?? [];
              const total = ms.reduce((s,m)=>s+(m.weight??0),0);
              const bad = ms.length > 1 && total !== 100;
              return (
                <div key={g.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="min-w-[180px]">
                    <div className="font-semibold text-sm">{g.name}</div>
                    {g.description ? <div className="text-xs text-muted">{g.description}</div> : null}
                    <div className="text-[11px] text-muted">{ms.length} member{ms.length!==1?'s':''}</div>
                  </div>
                  <div className="flex-1">
                    {ms.length ? (
                      <div className="space-y-1">
                        <div className="h-2.5 rounded-full overflow-hidden flex bg-ink border border-line/60">
                          {ms.sort((a,b)=>a.priority-b.priority).map((m,i)=> (
                            <div key={m.route_id} className={['bg-sky-500','bg-emerald-500','bg-amber-500','bg-violet-500','bg-rose-500'][i%5]!} style={{ width: `${Math.max(0,Math.min(100,(m.weight/Math.max(1,total))*100))}%` }} title={`${m.route_code ?? m.route_id.slice(0,8)} — ${m.weight}%`} />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {ms.sort((a,b)=>a.priority-b.priority).map((m,i)=> (
                            <span key={m.route_id} className="inline-flex items-center gap-1 text-[11px]">
                              <span className={`w-2 h-2 rounded-sm ${['bg-sky-500','bg-emerald-500','bg-amber-500','bg-violet-500','bg-rose-500'][i%5]}`} />{m.route_code ?? m.route_id.slice(0,8)} <span className="font-mono font-bold">{m.weight}%</span> <span className="text-muted">p{m.priority}</span>
                            </span>
                          ))}
                          <span className={`ml-auto text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border ${bad?'bg-red-500/15 text-red-300 border-red-500/30':'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>Σ {total}%{bad?' — must be 100':''}</span>
                        </div>
                      </div>
                    ) : <span className="text-xs text-muted">No members</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
