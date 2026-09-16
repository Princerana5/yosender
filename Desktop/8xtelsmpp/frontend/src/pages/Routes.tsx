import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, EmptyState, Icon, SearchInput } from '../components';

interface RouteVendor {
  vendor_id: string;
  vendor_name?: string;
  vendor_status?: string;
  priority: number;
  weight: number;
}

interface Route {
  id: string; name: string; channel: string; strategy: string; status: string;
  client_id: string | null;
  client_name?: string | null;
  country_id: string | null;
  country_name?: string | null;
  prefix: string | null;
  sender_id: string | null;
  tps_limit: number | null;
  price_per_segment: string | null;
  price_currency: string | null;
  min_margin_pct: string | null;
  min_vendor_cost: string | null;
  margin_floor: number | null;
  below_margin: boolean;
  msgs_24h?: string;
  msgs_7d?: string;
  filter_refs?: string;
  policy_count?: string;
  vendors: RouteVendor[] | null;
}

interface RouteDetail {
  route: Route & {
    delivered_7d?: string;
    exclusion_count?: string;
  };
  served_clients: Array<{ id: string; name: string; system_id: string }>;
  served_count: number;
  excluded: Array<{ id: string; name: string; system_id: string; excluded_at: string }>;
}

interface Opt {
  id: string;
  name: string;
  system_id?: string;
  iso_code?: string;
}

interface ChainItem {
  vendor_id: string;
  priority: number;
  weight: number;
}

const STRATEGIES: Array<[string, string]> = [
  ['priority', 'Strict priority order'],
  ['failover', 'Try next vendor on failure'],
  ['round_robin', 'Rotate across vendors'],
  ['least_cost', 'Cheapest vendor first'],
  ['percentage', 'Weighted distribution'],
];

const STRATEGY_HINT: Record<string, string> = {
  priority: 'First healthy vendor in priority order wins. Use for premium vs economy chains.',
  failover: 'Same as priority, but the chain is retried hop-by-hop on submit errors.',
  round_robin: 'Rotates the starting vendor per message. Use to spread load evenly.',
  least_cost: 'Cheapest vendor with a rate on file goes first. Needs vendor rates.',
  percentage: 'Weighted random pick per message (weight = % share). Full chain kept behind the pick for failover.',
};

export default function Routes(): JSX.Element {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);
  const [countries, setCountries] = useState<Opt[]>([]);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'global' | 'dedicated'>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const CURS = ['USD', 'EUR', 'INR'] as const;
  const [form, setForm] = useState({
    name: '', prefix: '', sender_id: '', strategy: 'priority',
    client_id: '', country_id: '', price: '', currency: 'USD', margin: '', tps: '',
  });
  const [editing, setEditing] = useState<Route | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCurrency, setEditCurrency] = useState('USD');
  const [editMargin, setEditMargin] = useState('');
  const [chain, setChain] = useState<ChainItem[]>([]);
  // Detail drawer
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Delete confirm (type-to-confirm for global routes with impact)
  const [deleting, setDeleting] = useState<{ route: Route; impact?: { msgs_7d: number; clients_served: number } } | null>(null);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteErr, setDeleteErr] = useState('');

  const load = (): void => {
    api<{ routes: Route[] }>('/routes').then((r) => setRoutes(r.routes)).catch(() => undefined);
  };
  useEffect(() => {
    load();
    api<{ clients: Opt[] }>('/clients').then((r) => setClients(r.clients)).catch(() => undefined);
    api<{ vendors: Opt[] }>('/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
    api<{ countries: Opt[] }>('/system/countries').then((r) => setCountries(r.countries)).catch(() => undefined);
  }, []);

  const vendorName = (id: string): string => vendors.find((v) => v.id === id)?.name ?? id.slice(0, 8);
  const clientName = (id: string | null): string =>
    !id ? 'All clients' : clients.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return routes.filter((r) => {
      if (scope === 'global' && r.client_id) return false;
      if (scope === 'dedicated' && !r.client_id) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (!needle) return true;
      const hay = [
        r.name, r.strategy, r.channel, r.prefix ?? '', r.sender_id ?? '',
        clientName(r.client_id), r.country_name ?? '',
        ...(r.vendors ?? []).map((v) => v.vendor_name ?? vendorName(v.vendor_id)),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [routes, q, scope, status, clients, vendors]);

  const counts = useMemo(() => ({
    all: routes.length,
    global: routes.filter((r) => !r.client_id).length,
    dedicated: routes.filter((r) => r.client_id).length,
    active: routes.filter((r) => r.status === 'active').length,
  }), [routes]);

  function toggleVendor(id: string): void {
    setChain((prev) => {
      if (prev.some((v) => v.vendor_id === id)) return prev.filter((v) => v.vendor_id !== id);
      return [...prev, { vendor_id: id, priority: prev.length + 1, weight: 100 }];
    });
  }

  function openModal(): void {
    setForm({ name: '', prefix: '', sender_id: '', strategy: 'priority', client_id: '', country_id: '', price: '', currency: 'USD', margin: '', tps: '' });
    setChain([]);
    setFormErr('');
    setShow(true);
  }

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!chain.length) {
      setFormErr('Pick at least one vendor below.');
      return;
    }
    setBusy(true);
    setFormErr('');
    try {
      await api('/routes', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          prefix: form.prefix || null,
          sender_id: form.sender_id || null,
          strategy: form.strategy,
          client_id: form.client_id || null,
          country_id: form.country_id || null,
          price_per_segment: form.price === '' ? null : Number(form.price),
          price_currency: form.currency,
          min_margin_pct: form.margin === '' ? null : Number(form.margin),
          tps_limit: form.tps === '' ? null : Math.max(1, Number(form.tps) || 0),
          vendors: chain,
        }),
      });
      setShow(false);
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePrice(): Promise<void> {
    if (!editing) return;
    setBusy(true);
    try {
      await api(`/routes/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          price_per_segment: editPrice === '' ? null : Number(editPrice),
          price_currency: editCurrency,
          min_margin_pct: editMargin === '' ? null : Number(editMargin),
        }),
      });
      setEditing(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(r: Route): Promise<void> {
    try {
      await api(`/routes/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: r.status === 'active' ? 'disabled' : 'active' }),
      });
      load();
      if (detail && detail.route.id === r.id) openDetail(r.id);
    } catch (e) {
      window.alert(`Could not update route: ${(e as Error).message}`);
    }
  }

  async function openDetail(id: string): Promise<void> {
    setDetailLoading(true);
    try {
      const r = await api<RouteDetail>(`/routes/${id}`);
      setDetail(r);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  /** First click: ask the server for impact. Global routes with traffic or
      multiple clients move to a type-to-confirm step; everything else deletes
      with a single confirm. */
  async function askDelete(r: Route): Promise<void> {
    setDeleteErr('');
    setDeleteTyped('');
    if (r.client_id) {
      // Dedicated: only ever served one client — single confirm is enough.
      if (!window.confirm(`Delete dedicated route "${r.name}" for ${clientName(r.client_id)}? Traffic falls back to global routes. This cannot be undone.`)) return;
      try {
        await api(`/routes/${r.id}`, { method: 'DELETE' });
        load();
      } catch (e) {
        window.alert(`Could not delete route: ${(e as Error).message}`);
      }
      return;
    }
    try {
      await api(`/routes/${r.id}`, { method: 'DELETE' });
      load(); // no impact → deleted outright
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('confirm required')) {
        // Re-fetch impact numbers for the confirm screen
        try {
          const d = await api<RouteDetail>(`/routes/${r.id}`);
          setDeleting({
            route: r,
            impact: {
              msgs_7d: Number(d.route.msgs_7d ?? 0),
              clients_served: d.served_count,
            },
          });
        } catch {
          setDeleting({ route: r });
        }
      } else {
        window.alert(`Could not delete route: ${msg}`);
      }
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    if (deleteTyped.trim().toUpperCase() !== 'DELETE') {
      setDeleteErr('Type DELETE to confirm.');
      return;
    }
    setBusy(true);
    setDeleteErr('');
    try {
      await api(`/routes/${deleting.route.id}?force=true`, { method: 'DELETE' });
      setDeleting(null);
      setDetail(null);
      load();
    } catch (e) {
      setDeleteErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Routes & failover"
        sub="Client → country → vendor chains · longest-prefix match wins"
        actions={<button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add route</button>}
      />

      {/* scope tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {([
            ['all', `All (${counts.all})`],
            ['global', `🌍 Global (${counts.global})`],
            ['dedicated', `🎯 Dedicated (${counts.dedicated})`],
          ] as const).map(([v, label]) => (
            <button key={v} onClick={() => setScope(v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${scope === v
                ? 'border-brand/50 text-emerald-300 bg-brand/10'
                : 'border-line text-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['all', 'active', 'disabled'] as const).map((v) => (
            <button key={v} onClick={() => setStatus(v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${status === v
                ? 'border-sky-500/50 text-sky-300 bg-sky-500/10'
                : 'border-line text-muted hover:text-white'}`}>
              {v === 'all' ? 'Any status' : v}
            </button>
          ))}
        </div>
        <div className="ml-auto w-full sm:w-auto sm:min-w-[260px]">
          <SearchInput value={q} onChange={setQ} onSearch={() => undefined} placeholder="Search route, client, vendor, prefix…" />
        </div>
      </div>

      {filtered.length ? (
        <DataTable
          keyOf={(r) => r.id}
          rows={filtered}
          columns={[
            {
              key: 'name', label: 'Route',
              render: (r) => (
                <div>
                  <button className="font-semibold text-sky-300 hover:text-sky-200 hover:underline text-left"
                    onClick={() => openDetail(r.id)} title="Open route detail">
                    {r.name}
                  </button>
                  <div className="flex items-center gap-1.5 mt-1">
                    {r.client_id ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand/10 text-emerald-300 border border-brand/25">
                        🎯 {clientName(r.client_id)}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-panel2 text-muted border border-line">
                        🌍 GLOBAL · all clients
                      </span>
                    )}
                    <span className="text-[11px] text-muted font-mono">{r.strategy}</span>
                  </div>
                  <div className="text-[11px] text-muted font-mono mt-0.5">
                    {[r.country_name ?? 'any country', r.prefix ? `prefix ${r.prefix}` : '', r.sender_id ? `sender ${r.sender_id}` : ''].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ),
            },
            {
              key: 'chain', label: 'Vendor chain',
              render: (r) => r.vendors?.length ? (
                <span className="flex items-center gap-1 flex-wrap">
                  {[...r.vendors].sort((a, b) => a.priority - b.priority).map((v, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted">→</span>}
                      <span className={`font-mono text-[11px] border rounded px-1.5 py-0.5 ${v.vendor_status && v.vendor_status !== 'enabled' ? 'bg-danger/10 text-red-300 border-danger/30' : 'bg-panel2 border-line'}`}
                        title={v.vendor_status && v.vendor_status !== 'enabled' ? `${v.vendor_name ?? vendorName(v.vendor_id)} is ${v.vendor_status}` : undefined}>
                        {v.vendor_name ?? vendorName(v.vendor_id)} · P{v.priority}
                        {r.strategy === 'percentage' ? ` · ${v.weight}%` : ''}
                      </span>
                    </span>
                  ))}
                </span>
              ) : <span className="text-red-300 text-xs">⚠ no vendors</span>,
            },
            {
              key: 'traffic', label: 'Traffic 24h / 7d', right: true,
              render: (r) => (
                <span className="tabular-nums text-xs">
                  <span className="font-semibold">{Number(r.msgs_24h ?? 0).toLocaleString()}</span>
                  <span className="text-muted"> / {Number(r.msgs_7d ?? 0).toLocaleString()}</span>
                </span>
              ),
            },
            {
              key: 'price', label: 'Price / seg', right: true,
              render: (r) => r.price_per_segment !== null && r.price_per_segment !== undefined ? (
                <span>
                  <button className={`tabular-nums font-semibold hover:underline ${r.below_margin ? 'text-red-300' : 'text-emerald-300'}`}
                    title={r.below_margin ? `Below margin floor ${r.margin_floor?.toFixed(4)} — click to edit` : 'Click to edit'}
                    onClick={() => { setEditing(r); setEditPrice(String(r.price_per_segment)); setEditCurrency(r.price_currency ?? 'USD'); setEditMargin(r.min_margin_pct ?? ''); }}>
                    {Number(r.price_per_segment).toFixed(4)} <span className="text-[10px] text-muted">{r.price_currency ?? 'USD'}</span>
                  </button>
                  {r.below_margin && (
                    <span className="block text-[10px] font-bold text-red-300" title={`Floor ${r.margin_floor?.toFixed(4)} = cost ${Number(r.min_vendor_cost).toFixed(4)} + ${Number(r.min_margin_pct).toFixed(1)}%`}>
                      ⚠ below margin (floor {r.margin_floor?.toFixed(4)})
                    </span>
                  )}
                </span>
              ) : (
                <button className="text-xs text-muted hover:text-white" title="Set route price"
                  onClick={() => { setEditing(r); setEditPrice(''); setEditCurrency('USD'); setEditMargin(r.min_margin_pct ?? ''); }}>
                  + set
                </button>
              ),
            },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', label: '', right: true,
              render: (r) => (
                <span className="flex gap-1 justify-end">
                  <button className="btn-ghost !px-2 !py-1 !text-xs" title="Open detail"
                    onClick={() => openDetail(r.id)}>
                    Detail
                  </button>
                  <button className={`btn-ghost !px-2 !py-1 !text-xs ${r.status === 'active' ? '' : '!border-brand/40 !text-emerald-300'}`}
                    title={r.status === 'active' ? 'Disable (stops matching, keeps history)' : 'Enable'}
                    onClick={() => toggleStatus(r)}>
                    {r.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn-ghost !px-2 !py-1 text-red-300 hover:text-red-200"
                    title={r.client_id ? `Delete dedicated route "${r.name}"` : `Delete GLOBAL route "${r.name}" (serves all clients)`}
                    onClick={() => askDelete(r)}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState icon="route" title={routes.length ? 'No routes match' : 'No routes yet'}
          sub={routes.length ? 'Try a different search or scope filter.' : 'Routes decide which vendor terminates each destination. Create one per country or prefix.'}
          action={!routes.length ? <button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add route</button> : undefined} />
      )}

      {/* ── Detail drawer ── */}
      {(detail || detailLoading) && (
        <Modal title={detail ? `Route — ${detail.route.name}` : 'Loading route…'} onClose={() => setDetail(null)} wide>
          {detailLoading && !detail && <div className="text-sm text-muted py-6 text-center">Loading…</div>}
          {detail && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={detail.route.status} />
                {detail.route.client_id ? (
                  <span className="text-[11px] font-bold px-2 py-1 rounded bg-brand/10 text-emerald-300 border border-brand/25">
                    🎯 Dedicated · {detail.route.client_name ?? clientName(detail.route.client_id)}
                  </span>
                ) : (
                  <span className="text-[11px] font-bold px-2 py-1 rounded bg-panel2 text-muted border border-line">
                    🌍 GLOBAL · serves {detail.served_count} client{detail.served_count === 1 ? '' : 's'}
                  </span>
                )}
                <span className="text-xs text-muted font-mono">{detail.route.strategy} · {detail.route.channel}</span>
                <span className="ml-auto flex gap-1.5">
                  <button className="btn-ghost !py-1 !px-2.5 !text-xs" onClick={() => toggleStatus(detail.route)}>
                    {detail.route.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn-ghost !py-1 !px-2.5 !text-xs text-red-300" onClick={() => askDelete(detail.route)}>
                    Delete…
                  </button>
                </span>
              </div>

              {/* traffic + refs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  ['Msgs 24h', Number(detail.route.msgs_24h ?? 0)],
                  ['Msgs 7d', Number(detail.route.msgs_7d ?? 0)],
                  ['Delivered 7d', Number((detail.route as { delivered_7d?: string }).delivered_7d ?? 0)],
                  ['Filter refs', Number(detail.route.filter_refs ?? 0)],
                ].map(([l, n]) => (
                  <div key={l as string} className="rounded-lg bg-ink/60 border border-line/60 py-2.5">
                    <div className="font-bold tabular-nums">{(n as number).toLocaleString()}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">{l}</div>
                  </div>
                ))}
              </div>

              {/* match + chain */}
              <div className="rounded-lg border border-line bg-ink/50 px-3.5 py-3 text-[13px] space-y-1">
                <div><span className="text-muted font-semibold">Matches: </span>
                  <span className="font-mono text-[12px]">
                    {[detail.route.country_name ?? 'any country', detail.route.prefix ? `prefix ${detail.route.prefix}` : 'any prefix', detail.route.sender_id ? `sender ${detail.route.sender_id}` : 'any sender', detail.route.tps_limit ? `${detail.route.tps_limit} TPS cap` : 'no TPS cap'].join(' · ')}
                  </span>
                </div>
                <div><span className="text-muted font-semibold">Chain: </span>
                  <span className="font-mono text-[12px]">
                    {detail.route.vendors?.length
                      ? [...detail.route.vendors].sort((a, b) => a.priority - b.priority).map((v) => `${v.vendor_name ?? vendorName(v.vendor_id)} (P${v.priority}${detail.route.strategy === 'percentage' ? `, ${v.weight}%` : ''})`).join(' → ')
                      : '⚠ no vendors — messages hitting this route fail with "no route" fallback'}
                  </span>
                </div>
                {Number(detail.route.policy_count ?? 0) > 0 && (
                  <div><span className="text-muted font-semibold">Traffic policies: </span>{detail.route.policy_count} attached</div>
                )}
              </div>

              {/* who it serves */}
              {!detail.route.client_id ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">
                    Serves {detail.served_count} client{detail.served_count === 1 ? '' : 's'} · detach removes ONE client safely
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {detail.served_clients.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm bg-ink/50 border border-line/60 rounded-lg px-3 py-1.5">
                        <Link className="font-semibold text-sky-300 hover:underline" to={`/clients/${c.id}`} onClick={() => setDetail(null)}>{c.name}</Link>
                        <span className="text-[11px] text-muted font-mono">{c.system_id}</span>
                        <button className="btn-ghost !py-0.5 !px-2 !text-[11px] ml-auto"
                          title={`Detach "${detail.route.name}" from ${c.name} only — route keeps serving everyone else`}
                          onClick={async () => {
                            if (!window.confirm(`Detach "${detail.route.name}" from ${c.name}?\n\nOnly this client stops using it. Everyone else keeps working.`)) return;
                            await api(`/routes/${detail.route.id}/detach`, { method: 'POST', body: JSON.stringify({ client_id: c.id }) });
                            openDetail(detail.route.id);
                            load();
                          }}>
                          Detach
                        </button>
                      </div>
                    ))}
                    {!detail.served_clients.length && <div className="text-sm text-muted">No active clients served (all detached or none exist).</div>}
                  </div>
                  {detail.excluded.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">
                        Detached ({detail.excluded.length}) — not served
                      </div>
                      <div className="space-y-1">
                        {detail.excluded.map((c) => (
                          <div key={c.id} className="flex items-center gap-2 text-sm bg-ink/30 border border-dashed border-line rounded-lg px-3 py-1.5 opacity-75">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-[11px] text-muted font-mono">{c.system_id}</span>
                            <button className="btn-ghost !py-0.5 !px-2 !text-[11px] ml-auto"
                              onClick={async () => {
                                await api(`/routes/${detail.route.id}/attach`, { method: 'POST', body: JSON.stringify({ client_id: c.id }) });
                                openDetail(detail.route.id);
                                load();
                              }}>
                              Re-attach
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[13px] text-muted">
                  Dedicated to <span className="text-gray-200 font-semibold">{detail.route.client_name ?? clientName(detail.route.client_id)}</span> —{' '}
                  <Link className="text-sky-300 hover:underline" to={`/clients/${detail.route.client_id}`} onClick={() => setDetail(null)}>open client →</Link>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ── Delete confirm for global routes with impact ── */}
      {deleting && (
        <Modal title={`Delete GLOBAL route — ${deleting.route.name}`} onClose={() => setDeleting(null)}>
          <div className="space-y-3">
            <div className="text-sm text-amber-300 bg-warn/10 border border-warn/30 rounded-lg px-3 py-2.5">
              🌍 This is a <b>GLOBAL</b> route — it serves <b>all clients</b>
              {deleting.impact ? (
                <> (currently <b>{deleting.impact.clients_served}</b> active client{deleting.impact.clients_served === 1 ? '' : 's'}, <b>{deleting.impact.msgs_7d.toLocaleString()}</b> msgs in 7d)</>
              ) : null}.
              Deleting removes it for <b>everyone</b> permanently.
            </div>
            <div className="text-[13px] text-muted space-y-1">
              <div>✓ Safer: <b className="text-gray-200">Detach</b> it from one client (route detail → Detach), or <b className="text-gray-200">Disable</b> it (stops matching, keeps history, one-click re-enable).</div>
              <div>✗ Delete only if the route is truly obsolete for all clients.</div>
            </div>
            <div>
              <label className="label">Type DELETE to permanently remove this global route</label>
              <input className="input font-mono" placeholder="DELETE" value={deleteTyped}
                onChange={(e) => setDeleteTyped(e.target.value)} autoFocus />
            </div>
            {deleteErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{deleteErr}</div>}
            <div className="flex gap-2">
              <button className="btn flex-1 !border-danger/50 !bg-danger/20 !text-red-200 hover:!bg-danger/30" onClick={confirmDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete for all clients'}
              </button>
              <button className="btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {show && (
        <Modal title="New route" onClose={() => setShow(false)} wide>
          <form onSubmit={create} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div>
              <label className="label">Route name</label>
              <input className="input" placeholder="India Premium — all clients" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Client scope</label>
                <select className="input" value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">🌍 Global — all clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>🎯 {c.name} ({c.system_id}) — dedicated</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted mt-1">
                  {form.client_id
                    ? '🎯 Dedicated: only this client uses it. Safe to delete anytime.'
                    : '🌍 Global: every client falls back to it. Deleting later needs typed confirmation.'}
                </p>
              </div>
              <div>
                <label className="label">Country</label>
                <select className="input" value={form.country_id}
                  onChange={(e) => setForm({ ...form, country_id: e.target.value })}>
                  <option value="">All countries</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Prefix <span className="text-gray-600">(blank = any)</span></label>
                <input className="input font-mono" placeholder="91" value={form.prefix}
                  onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
              </div>
              <div>
                <label className="label">Sender ID <span className="text-gray-600">(blank = any)</span></label>
                <input className="input font-mono" placeholder="8XTEL" value={form.sender_id}
                  onChange={(e) => setForm({ ...form, sender_id: e.target.value })} />
              </div>
              <div>
                <label className="label">TPS cap <span className="text-gray-600">(blank = none)</span></label>
                <input className="input font-mono" placeholder="100" value={form.tps}
                  onChange={(e) => setForm({ ...form, tps: e.target.value })} inputMode="numeric" />
              </div>
            </div>
            <div>
              <label className="label">Price / segment <span className="text-gray-600">(blank = client rates)</span></label>
              <div className="flex gap-1.5">
                <input className="input font-mono flex-1" placeholder="0.0045" value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
                <select className="input !w-auto" value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {CURS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-muted mt-1">
                Route price × segments is held from the wallet at submit. Blank falls back to the client's rate card.
              </p>
            </div>
            <div>
              <label className="label">Min margin % <span className="text-gray-600">(blank = no guard · warn-only)</span></label>
              <input className="input font-mono" placeholder="15" value={form.margin}
                onChange={(e) => setForm({ ...form, margin: e.target.value })} inputMode="decimal" />
            </div>
            <div>
              <label className="label">Vendors in this route (click to add, first added = priority 1)</label>
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {vendors.map((v) => {
                  const picked = chain.find((c) => c.vendor_id === v.id);
                  return (
                    <label key={v.id}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition ${picked ? 'border-brand/50 bg-brand/5' : 'border-line hover:border-brand/30'}`}>
                      <input type="checkbox" checked={!!picked} onChange={() => toggleVendor(v.id)} className="accent-emerald-500" />
                      <span className="text-sm font-medium">{v.name}</span>
                      {picked && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                          P
                          <input type="number" min={1} value={picked.priority}
                            onChange={(e) => setChain(chain.map((c) => c.vendor_id === v.id ? { ...c, priority: Number(e.target.value) } : c))}
                            className="input font-mono !w-14 !py-1 !px-2 !text-xs" />
                          {form.strategy === 'percentage' && (
                            <span className="flex items-center gap-1">
                              %
                              <input type="number" min={1} max={100} value={picked.weight}
                                onChange={(e) => setChain(chain.map((c) => c.vendor_id === v.id ? { ...c, weight: Number(e.target.value) } : c))}
                                className="input font-mono !w-14 !py-1 !px-2 !text-xs" />
                            </span>
                          )}
                        </span>
                      )}
                    </label>
                  );
                })}
                {!vendors.length && <div className="text-sm text-muted">No vendors yet — create one under Vendors first.</div>}
              </div>
            </div>
            <div>
              <label className="label">Strategy</label>
              <div className="space-y-1.5">
                {STRATEGIES.map(([v, desc]) => (
                  <label key={v}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition ${form.strategy === v ? 'border-brand/50 bg-brand/5' : 'border-line hover:border-brand/30'}`}>
                    <input type="radio" name="strategy" value={v} checked={form.strategy === v}
                      onChange={() => setForm({ ...form, strategy: v })} className="accent-emerald-500" />
                    <span className="font-mono text-[13px]">{v}</span>
                    <span className="text-xs text-muted ml-auto text-right">{desc}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-1.5">{STRATEGY_HINT[form.strategy]}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create route'}</button>
              <button className="btn-ghost" type="button" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`Route price — ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <p className="text-xs text-muted">
              Sell price per segment. Held from the client's wallet at submit (× segments).
              Blank = fall back to the client's rate card.
            </p>
            <div>
              <label className="label">Price / segment</label>
              <div className="flex gap-1.5">
                <input className="input font-mono text-lg flex-1" placeholder="0.0045 — blank for rate card"
                  value={editPrice} onChange={(e) => setEditPrice(e.target.value)} inputMode="decimal" autoFocus />
                <select className="input !w-auto" value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value)}>
                  {CURS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Min margin % <span className="text-gray-600">(warn-only guard)</span></label>
              <input className="input font-mono" placeholder="15 — blank = no guard"
                value={editMargin} onChange={(e) => setEditMargin(e.target.value)} inputMode="decimal" />
              <p className="text-[11px] text-muted mt-1">
                Warns when sell price drops below vendor cost + this %. Sends are never blocked.
                {editing.min_vendor_cost
                  ? ` Cheapest vendor cost here: ${Number(editing.min_vendor_cost).toFixed(4)}.`
                  : ' No vendor cost on file yet — set vendor rates first.'}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={savePrice} disabled={busy}>
                {busy ? 'Saving…' : 'Save price'}
              </button>
              <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
