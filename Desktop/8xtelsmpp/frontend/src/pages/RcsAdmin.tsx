import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, Icon } from '../components';

type View = 'vendors' | 'routes' | 'clients' | 'rates' | 'senders' | 'traffic' | 'campaigns' | 'reports' | 'webhooks';

export default function RcsAdmin(): JSX.Element {
  const [view, setView] = useState<View>('vendors');
  const tabs: Array<[View, string]> = [
    ['vendors', 'Vendors'], ['routes', 'Routes'], ['clients', 'Clients'],
    ['rates', 'Rates'], ['senders', 'Senders'], ['traffic', 'Traffic'],
    ['campaigns', 'Campaigns'], ['reports', 'Reports'], ['webhooks', 'Webhooks'],
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="RCS" sub="Vendors → Routes → Client enable · separate from SMS domain" />
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition ${view === v ? 'border-brand/50 bg-brand/10 text-emerald-300' : 'border-line text-muted hover:text-white'}`}>
            {l}
          </button>
        ))}
      </div>
      {view === 'vendors' && <RcsVendors />}
      {view === 'routes' && <RcsRoutes />}
      {view === 'clients' && <RcsClients />}
      {view === 'rates' && <RcsRates />}
      {view === 'senders' && <RcsSenders />}
      {view === 'traffic' && <RcsTraffic />}
      {view === 'campaigns' && <RcsCampaigns />}
      {view === 'reports' && <RcsReports />}
      {view === 'webhooks' && <RcsWebhooks />}
    </div>
  );
}

function RcsVendors(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ name: '', endpoint: '', api_key: '', webhook_secret: '', provider_key: 'generic-http', tps_limit: '50', timeout_ms: '10000', status: 'disabled' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = (): void => { api<{ vendors: Record<string, unknown>[] }>('/rcs/vendors').then((r) => setRows(r.vendors)).catch(() => undefined); };
  useEffect(load, []);
  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api('/rcs/vendors', { method: 'POST', body: JSON.stringify({ name: form.name, provider_key: form.provider_key || 'generic-http', endpoint: form.endpoint, credentials: { api_key: form.api_key }, webhook_secret: form.webhook_secret || undefined, status: form.status as never, tps_limit: Number(form.tps_limit) || 10, timeout_ms: Number(form.timeout_ms) || 10000 }) });
      setShow(false); load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><div className="text-sm text-muted">{rows.length} vendor(s)</div><button className="btn" onClick={() => setShow(true)}>+ Vendor</button></div>
      <DataTable keyOf={(r, i) => String(r.id ?? i)} rows={rows} empty="No RCS vendors yet — add one to connect a provider." columns={[
        { key: 'name', label: 'Name', render: (r) => <span className="font-semibold">{String(r.name)}</span> },
        { key: 'endpoint', label: 'Endpoint', mono: true, render: (r) => <span className="text-[11px] max-w-[280px] truncate block">{String(r.endpoint)}</span> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
        { key: 'tps_limit', label: 'TPS' },
      ]} />
      {show && (
        <Modal title="New RCS vendor" onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="space-y-1"><span className="label">Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="space-y-1"><span className="label">Status</span><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="disabled">disabled</option><option value="enabled">enabled</option><option value="degraded">degraded</option></select></label>
            </div>
            <label className="space-y-1"><span className="label">Endpoint (public HTTPS)</span><input className="input font-mono" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="https://provider.example.com/rcs/send" required /></label>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="space-y-1"><span className="label">API key</span><input className="input font-mono" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} required /></label>
              <label className="space-y-1"><span className="label">Webhook secret (optional)</span><input className="input font-mono" value={form.webhook_secret} onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })} placeholder="hmac secret for POST /rcs/webhooks/:vendorId" /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="label">TPS</span><input className="input" type="number" value={form.tps_limit} onChange={(e) => setForm({ ...form, tps_limit: e.target.value })} /></label>
              <label className="space-y-1"><span className="label">Timeout ms</span><input className="input" type="number" value={form.timeout_ms} onChange={(e) => setForm({ ...form, timeout_ms: e.target.value })} /></label>
            </div>
            {err && <div className="text-sm text-red-300">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn" disabled={busy}>{busy ? '…' : 'Create'}</button></div>
            <div className="text-[11px] text-muted">Credentials are AES-256-GCM encrypted with RCS_SECRET_KEY. Webhook: provider POSTs to <span className="font-mono">/rcs/webhooks/:vendorId</span> with header <span className="font-mono">x-rcs-signature: hmac_sha256(JSON.stringify(body), webhook_secret)</span>.</div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function RcsRoutes(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string }>>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ name: '', country_id: '', sender: '', strategy: 'priority', status: 'disabled', tps_limit: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const load = (): void => { api<{ routes: Record<string, unknown>[] }>('/rcs/routes').then((r) => setRows(r.routes)).catch(() => undefined); };
  useEffect(() => { load(); api<{ countries: Array<{ id: string; name: string }> }>('/system/countries').then((r) => setCountries(r.countries ?? [])).catch(() => undefined); }, []);
  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api('/rcs/routes', { method: 'POST', body: JSON.stringify({ name: form.name, country_id: form.country_id || null, sender: form.sender || null, strategy: form.strategy as never, status: form.status as never, tps_limit: form.tps_limit ? Number(form.tps_limit) : null }) });
      setShow(false); load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><div className="text-sm text-muted">{rows.length} route(s)</div><button className="btn" onClick={() => setShow(true)}>+ Route</button></div>
      <DataTable keyOf={(r, i) => String(r.id ?? i)} rows={rows} empty="No RCS routes yet." columns={[
        { key: 'name', label: 'Name', render: (r) => <button className="font-semibold text-sky-300 hover:underline text-left" onClick={() => setSelected(r)}>{String(r.name)}</button> },
        { key: 'sender', label: 'Sender', mono: true, render: (r) => String(r.sender ?? '—') },
        { key: 'strategy', label: 'Strategy', mono: true },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
        { key: 'vendors', label: 'Vendors', render: (r) => String(Array.isArray(r.vendors) ? (r.vendors as unknown[]).length : '0') },
      ]} />
      {show && (
        <Modal title="New RCS route" onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-3">
            <label className="space-y-1"><span className="label">Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="space-y-1"><span className="label">Country (optional)</span><select className="input" value={form.country_id} onChange={(e) => setForm({ ...form, country_id: e.target.value })}><option value="">Any</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="space-y-1"><span className="label">Sender (optional)</span><input className="input font-mono" value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} placeholder="Brand" /></label>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="space-y-1"><span className="label">Strategy</span><select className="input" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}><option value="priority">priority</option><option value="percentage">percentage</option><option value="failover">failover</option></select></label>
              <label className="space-y-1"><span className="label">Status</span><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="disabled">disabled</option><option value="active">active</option></select></label>
              <label className="space-y-1"><span className="label">TPS (optional)</span><input className="input" type="number" value={form.tps_limit} onChange={(e) => setForm({ ...form, tps_limit: e.target.value })} /></label>
            </div>
            {err && <div className="text-sm text-red-300">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn" disabled={busy}>{busy ? '…' : 'Create'}</button></div>
            <div className="text-[11px] text-muted">After creating, open the route row to assign vendors (priority/weight) and clients.</div>
          </form>
        </Modal>
      )}
      {selected && <RcsRouteDetail route={selected} countries={countries} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RcsRouteDetail({ route, countries, onClose }: { route: Record<string, unknown>; countries: Array<{ id: string; name: string }>; onClose: () => void }): JSX.Element {
  const id = String(route.id);
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [assignedV, setAssignedV] = useState<string[]>([]); const [assignedC, setAssignedC] = useState<string[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ vendors: Array<{ id: string; name: string }>} >('/rcs/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
    api<{ clients: Array<{ id: string; name: string }>} >('/rcs/clients').then((r) => setClients(r.clients)).catch(() => undefined);
    const v = route.vendors; if (Array.isArray(v)) setAssignedV(v.map((x: Record<string, unknown>) => String(x.vendor_id ?? x.id ?? '')));
    const c = route.client_ids; if (Array.isArray(c)) setAssignedC(c.map(String));
  }, [id]);
  async function saveV(): Promise<void> {
    setErr('');
    try { await api(`/rcs/routes/${id}/vendors`, { method: 'PUT', body: JSON.stringify({ vendors: assignedV.map((vid, i) => ({ vendor_id: vid, priority: i + 1, weight: 100 })) }) }); }
    catch (e) { setErr((e as Error).message); }
  }
  async function saveC(): Promise<void> {
    setErr('');
    try { await api(`/rcs/routes/${id}/clients`, { method: 'PUT', body: JSON.stringify({ client_ids: assignedC }) }); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={`Route · ${String(route.name)}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="text-sm text-muted">Country: {String(route.country_name ?? 'Any')} · Sender: {String(route.sender ?? 'Any')} · Strategy: {String(route.strategy)} · Status: {String(route.status)}</div>
        <div className="card card-pad">
          <div className="card-title">Vendors (priority order)</div>
          <div className="mt-2 space-y-1.5 max-h-[180px] overflow-auto">
            {vendors.map((v) => (
              <label key={v.id} className="flex items-center gap-2 text-sm border border-line rounded px-2.5 py-1.5 bg-ink/40">
                <input type="checkbox" checked={assignedV.includes(v.id)} onChange={(e) => setAssignedV((a) => e.target.checked ? [...a, v.id] : a.filter((x) => x !== v.id))} />
                <span className="font-mono">{v.name}</span>
              </label>
            ))}
            {!vendors.length && <div className="text-sm text-muted">No vendors — create one first.</div>}
          </div>
          <button className="btn-ghost !py-1.5 !text-xs mt-2" onClick={() => void saveV()}>Save vendors</button>
        </div>
        <div className="card card-pad">
          <div className="card-title">Clients assigned</div>
          <div className="mt-2 space-y-1.5 max-h-[180px] overflow-auto">
            {clients.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm border border-line rounded px-2.5 py-1.5 bg-ink/40">
                <input type="checkbox" checked={assignedC.includes(c.id)} onChange={(e) => setAssignedC((a) => e.target.checked ? [...a, c.id] : a.filter((x) => x !== c.id))} />
                <span>{c.name}</span>
              </label>
            ))}
            {!clients.length && <div className="text-sm text-muted">No clients.</div>}
          </div>
          <button className="btn-ghost !py-1.5 !text-xs mt-2" onClick={() => void saveC()}>Save clients</button>
        </div>
        {err && <div className="text-sm text-red-300">{err}</div>}
      </div>
    </Modal>
  );
}

function RcsClients(): JSX.Element {
  const [rows, setRows] = useState<Array<{ id: string; name: string; rcs_enabled: boolean; status: string }>>([]);
  const [busy, setBusy] = useState('');
  const load = (): void => { api<{ clients: typeof rows }>('/rcs/clients').then((r) => setRows(r.clients as never)).catch(() => undefined); };
  useEffect(load, []);
  async function toggle(r: typeof rows[number]): Promise<void> {
    setBusy(r.id);
    try { await api(`/rcs/clients/${r.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !r.rcs_enabled }) }); load(); } finally { setBusy(''); }
  }
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted">Enable RCS per client — required for portal/SMPP RCS and route eligibility.</div>
      <DataTable keyOf={(r: Record<string, unknown>) => String(r.id)} rows={rows as unknown as Record<string, unknown>[]} empty="No clients." columns={[
        { key: 'name', label: 'Client', render: (r: Record<string, unknown>) => <span className="font-semibold">{String(r.name)}</span> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
        { key: 'rcs_enabled', label: 'RCS', render: (r) => <StatusBadge status={String(r.rcs_enabled) === 'true' ? 'delivered' : 'failed'} /> },
        { key: 'action', label: '', render: (r) => <button className="btn-ghost !py-1 !text-xs" disabled={busy === String(r.id)} onClick={() => void toggle(r as never)}>{busy === String(r.id) ? '…' : (String(r.rcs_enabled) === 'true' ? 'Disable' : 'Enable')}</button> },
      ]} />
    </div>
  );
}

function RcsRates(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [countries, setCountries] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ client_id: '', country_id: '', price: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = (): void => { api<{ rates: Record<string, unknown>[] }>('/rcs/rates').then((r) => setRows(r.rates)).catch(() => undefined); };
  useEffect(() => { load(); api<{ clients: typeof clients }>('/rcs/clients').then((r) => setClients(r.clients as never)).catch(() => undefined); api<{ countries: typeof countries }>('/system/countries').then((r) => setCountries(r.countries ?? [])).catch(() => undefined); }, []);
  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/rcs/rates', { method: 'POST', body: JSON.stringify({ client_id: form.client_id, country_id: form.country_id, price: Number(form.price) }) }); setForm({ client_id: form.client_id, country_id: '', price: '' }); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={save} className="card card-pad flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="label">Client</span><select className="input min-w-[160px]" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} required><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="space-y-1"><span className="label">Country</span><select className="input min-w-[140px]" value={form.country_id} onChange={(e) => setForm({ ...form, country_id: e.target.value })} required><option value="">—</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="space-y-1"><span className="label">Price</span><input className="input w-[120px]" type="number" step="0.000001" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
        <button className="btn" disabled={busy}>{busy ? '…' : 'Add rate'}</button>
        {err && <span className="text-sm text-red-300">{err}</span>}
      </form>
      <DataTable keyOf={(r, i) => String(r.id ?? i)} rows={rows} empty="No RCS rates yet." columns={[
        { key: 'client_name', label: 'Client' }, { key: 'country_name', label: 'Country' }, { key: 'price', label: 'Price', render: (r) => String(r.price) },
      ]} />
    </div>
  );
}

function RcsSenders(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ client_id: '', sender: '', status: 'approved' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = (): void => { api<{ senders: Record<string, unknown>[] }>('/rcs/senders').then((r) => setRows(r.senders)).catch(() => undefined); };
  useEffect(() => { load(); api<{ clients: typeof clients }>('/rcs/clients').then((r) => setClients(r.clients as never)).catch(() => undefined); }, []);
  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/rcs/senders', { method: 'POST', body: JSON.stringify({ client_id: form.client_id, sender: form.sender, status: form.status }) }); setForm({ client_id: form.client_id, sender: '', status: 'approved' }); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={save} className="card card-pad flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="label">Client</span><select className="input min-w-[160px]" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} required><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="space-y-1"><span className="label">Sender</span><input className="input font-mono" value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} placeholder="Brand" required /></label>
        <label className="space-y-1"><span className="label">Status</span><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="approved">approved</option><option value="pending">pending</option><option value="blocked">blocked</option></select></label>
        <button className="btn" disabled={busy}>{busy ? '…' : 'Add sender'}</button>
        {err && <span className="text-sm text-red-300">{err}</span>}
      </form>
      <DataTable keyOf={(r, i) => String(r.id ?? i)} rows={rows} empty="No RCS senders yet." columns={[
        { key: 'client_name', label: 'Client' }, { key: 'sender', label: 'Sender', mono: true }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
      ]} />
    </div>
  );
}

function RcsTraffic(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api<{ messages: Record<string, unknown>[] }>('/rcs/traffic?limit=100').then((r) => setRows(r.messages)).catch(() => undefined); }, []);
  return <DataTable keyOf={(r, i) => String((r as Record<string, unknown>).id ?? i)} rows={rows} empty="No RCS traffic yet." columns={[
    { key: 'sender', label: 'From', mono: true }, { key: 'destination', label: 'To', mono: true }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> }, { key: 'vendor_name', label: 'Vendor' }, { key: 'price', label: 'Price' },
  ]} />;
}

function RcsCampaigns(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api<{ campaigns: Record<string, unknown>[] }>('/rcs/campaigns').then((r) => setRows(r.campaigns)).catch(() => undefined); }, []);
  return <DataTable keyOf={(r, i) => String((r as Record<string, unknown>).id ?? i)} rows={rows} empty="No RCS campaigns yet." columns={[
    { key: 'name', label: 'Name' }, { key: 'sender', label: 'Sender', mono: true }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> }, { key: 'recipient_count', label: 'Recipients' },
  ]} />;
}

function RcsReports(): JSX.Element {
  const [data, setData] = useState<{ totals: Record<string, string>; daily: Array<Record<string, string>> } | null>(null);
  useEffect(() => { api<typeof data & Record<string, unknown>>('/rcs/reports').then((r) => setData(r as never)).catch(() => undefined); }, []);
  if (!data) return <div className="text-sm text-muted">Loading…</div>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{String(data.totals.total ?? '0')}</div></div>
        <div className="stat-card"><div className="stat-label">Delivered</div><div className="stat-value text-emerald-300">{String(data.totals.delivered ?? '0')}</div></div>
        <div className="stat-card"><div className="stat-label">Failed</div><div className="stat-value text-red-300">{String(data.totals.failed ?? '0')}</div></div>
      </div>
      <DataTable keyOf={(r, i) => String(r.day ?? i)} rows={data.daily} empty="No daily stats yet." columns={[
        { key: 'day', label: 'Day', render: (r) => String(r.day).slice(0, 10) }, { key: 'total', label: 'Total' }, { key: 'delivered', label: 'Delivered' },
      ]} />
    </div>
  );
}

function RcsWebhooks(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api<{ events: Record<string, unknown>[] }>('/rcs/webhooks').then((r) => setRows(r.events)).catch(() => undefined); }, []);
  return <DataTable keyOf={(r, i) => String((r as Record<string, unknown>).id ?? i)} rows={rows} empty="No webhook events yet." columns={[
    { key: 'vendor_name', label: 'Vendor' }, { key: 'provider_message_id', label: 'Provider ID', mono: true }, { key: 'processing_status', label: 'Status', render: (r) => <StatusBadge status={String(r.processing_status)} /> }, { key: 'received_at', label: 'Received', render: (r) => <span className="text-xs text-muted">{r.received_at ? new Date(String(r.received_at)).toLocaleString() : '—'}</span> },
  ]} />;
}
