import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, EmptyState, Icon } from '../components';

interface Route {
  id: string; name: string; channel: string; strategy: string; status: string;
  client_id: string | null;
  country_id: string | null;
  country_name?: string | null;
  price_per_segment: string | null;
  price_currency: string | null;
  min_margin_pct: string | null;
  min_vendor_cost: string | null;
  margin_floor: number | null;
  below_margin: boolean;
  vendors: Array<{ vendor_id: string; priority: number; weight: number }> | null;
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

const STRATEGIES = [
  ['priority', 'Strict priority order'],
  ['failover', 'Try next vendor on failure'],
  ['round_robin', 'Rotate across vendors'],
  ['least_cost', 'Cheapest vendor first'],
  ['percentage', 'Weighted distribution'],
] as const;

export default function Routes(): JSX.Element {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);
  const [countries, setCountries] = useState<Opt[]>([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const CURS = ['USD', 'EUR', 'INR'] as const;
  const [form, setForm] = useState({ name: '', prefix: '', strategy: 'priority', client_id: '', country_id: '', price: '', currency: 'USD', margin: '' });
  const [editing, setEditing] = useState<Route | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCurrency, setEditCurrency] = useState('USD');
  const [editMargin, setEditMargin] = useState('');
  const [chain, setChain] = useState<ChainItem[]>([]);

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

  function toggleVendor(id: string): void {
    setChain((prev) => {
      if (prev.some((v) => v.vendor_id === id)) return prev.filter((v) => v.vendor_id !== id);
      return [...prev, { vendor_id: id, priority: prev.length + 1, weight: 100 }];
    });
  }

  function openModal(): void {
    setForm({ name: '', prefix: '', strategy: 'priority', client_id: '', country_id: '', price: '', currency: 'USD', margin: '' });
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
          strategy: form.strategy,
          client_id: form.client_id || null,
          country_id: form.country_id || null,
          price_per_segment: form.price === '' ? null : Number(form.price),
          price_currency: form.currency,
          min_margin_pct: form.margin === '' ? null : Number(form.margin),
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

  async function remove(r: Route): Promise<void> {
    if (!window.confirm(`Delete route "${r.name}"? Traffic falls back to the next matching route. This cannot be undone.`)) return;
    try {
      await api(`/routes/${r.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      window.alert(`Could not delete route: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Routes & failover"
        sub="Client → country → vendor chains · longest-prefix match wins"
        actions={<button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add route</button>}
      />

      {routes.length ? (
        <DataTable
          keyOf={(r) => r.id}
          rows={routes}
          columns={[
            { key: 'name', label: 'Route', render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'client', label: 'Client', render: (r) => <span>{clientName(r.client_id)}</span> },
            { key: 'channel', label: 'Channel', render: (r) => <span className="badge bg-sky-500/10 text-sky-300 border border-sky-500/25">{r.channel}</span> },
            { key: 'strategy', label: 'Strategy', mono: true },
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
              key: 'chain', label: 'Vendor chain',
              render: (r) => r.vendors?.length ? (
                <span className="flex items-center gap-1 flex-wrap">
                  {[...r.vendors].sort((a, b) => a.priority - b.priority).map((v, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted">→</span>}
                      <span className="font-mono text-[11px] bg-panel2 border border-line rounded px-1.5 py-0.5">
                        {vendorName(v.vendor_id)} · P{v.priority}
                      </span>
                    </span>
                  ))}
                </span>
              ) : <span className="text-muted">—</span>,
            },
            {
              key: 'actions', label: '', right: true,
              render: (r) => (
                <button className="btn-ghost !px-2 !py-1 text-red-300 hover:text-red-200"
                  title={`Delete route "${r.name}"`} onClick={() => remove(r)}>
                  <Icon name="trash" size={14} />
                </button>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState icon="route" title="No routes yet"
          sub="Routes decide which vendor terminates each destination. Create one per country or prefix."
          action={<button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add route</button>} />
      )}

      {show && (
        <Modal title="New route" onClose={() => setShow(false)} wide>
          <form onSubmit={create} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div>
              <label className="label">Route name</label>
              <input className="input" placeholder="Client 1 via Vendor 1" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Client</label>
                <select className="input" value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">All clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.system_id})</option>
                  ))}
                </select>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Prefix <span className="text-gray-600">(blank = any)</span></label>
                <input className="input font-mono" placeholder="91" value={form.prefix}
                  onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
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
              </div>
            </div>
            <p className="text-[11px] text-muted -mt-2">
              Route price × segments is held from the wallet at submit. Blank falls back to the client's rate card.
            </p>
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
                    <span className="text-xs text-muted ml-auto">{desc}</span>
                  </label>
                ))}
              </div>
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
