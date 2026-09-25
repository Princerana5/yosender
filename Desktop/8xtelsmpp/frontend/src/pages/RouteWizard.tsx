import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Modal, SearchInput, StatusBadge, Icon } from '../components';
import { STRATEGIES, STRATEGY_HINT } from '../lib/route-constants';

interface VendorOpt {
  id: string; name: string; status?: string; host?: string; system_id?: string;
  active_route_count?: string; coverage_count?: string;
  tps?: number;
}
interface RouteOpt {
  id: string; name: string; channel: string; strategy: string; status: string;
  country_id: string | null; country_name?: string | null;
  prefix: string | null; sender_id: string | null;
  tps_limit: number | null;
  price_per_segment: string | null; price_currency: string | null;
  min_margin_pct: string | null; min_vendor_cost?: string | null;
  margin_floor?: number | null; below_margin?: boolean;
  vendors?: Array<{ vendor_id: string; vendor_name?: string; priority: number }> | null;
  route_client_rate_count?: string;
}
interface ClientOpt {
  id: string; name: string; system_id: string; status: string;
  currency?: string; balance?: string | number;
}
interface CountryOpt { id: string; name: string; iso_code?: string }

function StepIndicator({ step }: { step: number }): JSX.Element {
  const labels = ['Vendor', 'Route', 'Client', 'Rate', 'Review'];
  return (
    <div className="flex items-center gap-1.5">
      {labels.map((lbl, i) => {
        const n = i + 1;
        const done = step > n;
        const cur = step === n;
        return (
          <div key={lbl} className="flex items-center gap-1.5 flex-1">
            <div className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-[11px] font-bold transition
              ${done ? 'bg-brand/15 text-emerald-300 border-brand/40' : cur ? 'bg-brand text-white border-brand' : 'bg-panel2 text-muted border-line'}`}>
              {done ? '✓' : n}
            </div>
            <span className={`text-[11px] font-semibold hidden sm:inline ${cur ? 'text-white' : done ? 'text-emerald-300' : 'text-muted'}`}>{lbl}</span>
            {i < labels.length - 1 && <span className="flex-1 h-px bg-line/60 mx-1 hidden sm:block" />}
          </div>
        );
      })}
    </div>
  );
}

export function RouteWizard({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: () => void;
}): JSX.Element | null {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [routesForVendor, setRoutesForVendor] = useState<RouteOpt[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [countries, setCountries] = useState<CountryOpt[]>([]);
  const [vendor, setVendor] = useState<VendorOpt | null>(null);
  const [vendorQ, setVendorQ] = useState('');
  const [route, setRoute] = useState<RouteOpt | null | 'create-new'>(null);
  const [routeQ, setRouteQ] = useState('');
  const [newRoute, setNewRoute] = useState({
    name: '', country_id: '', prefix: '', sender_id: '', strategy: 'priority', status: 'active', tps: '',
  });
  const [client, setClient] = useState<ClientOpt | null>(null);
  const [clientQ, setClientQ] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sendRn, setSendRn] = useState(false);
  const [rnValidFrom, setRnValidFrom] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    const pad = (n:number)=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [rnCc, setRnCc] = useState('');
  const [rnBcc, setRnBcc] = useState('');
  const [rnIncludeAttachment, setRnIncludeAttachment] = useState(true);
  const [rnPreview, setRnPreview] = useState<null | { to:string; cc:string[]; bcc:string[]; subject:string; html:string; attachment:{filename:string; route_count:number; countries:number; networks:number; empty:boolean; error?:string} | null }>(null);
  const [rnBusy, setRnBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1); setVendor(null); setRoute(null); setClient(null); setPrice(''); setErr('');
    setNewRoute({ name: '', country_id: '', prefix: '', sender_id: '', strategy: 'priority', status: 'active', tps: '' });
    setVendorQ(''); setRouteQ(''); setClientQ('');
    setSendRn(false); setRnCc(''); setRnBcc(''); setRnIncludeAttachment(true); setRnPreview(null); setRnBusy(false);
    {
      const d = new Date(Date.now() + 3600_000);
      const pad = (n:number)=>String(n).padStart(2,'0');
      setRnValidFrom(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    api<{ vendors: VendorOpt[] }>('/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
    api<{ countries: CountryOpt[] }>('/system/countries').then((r) => setCountries(r.countries)).catch(() => undefined);
    api<{ clients: ClientOpt[] }>('/clients').then((r) => setClients(r.clients)).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!vendor || step < 2) return;
    api<{ routes: RouteOpt[] }>(`/routes?vendor_id=${vendor.id}`).then((r) => setRoutesForVendor(r.routes)).catch(() => setRoutesForVendor([]));
  }, [vendor, step]);

  const vendorList = useMemo(() => {
    const needle = vendorQ.trim().toLowerCase();
    if (!needle) return vendors;
    return vendors.filter((v) => [v.name, v.system_id ?? '', v.host ?? '', v.id].join(' ').toLowerCase().includes(needle));
  }, [vendors, vendorQ]);

  const routeList = useMemo(() => {
    const needle = routeQ.trim().toLowerCase();
    if (!needle) return routesForVendor;
    return routesForVendor.filter((r) => [r.name, r.prefix ?? '', r.sender_id ?? '', r.country_name ?? '', r.strategy].join(' ').toLowerCase().includes(needle));
  }, [routesForVendor, routeQ]);

  const clientList = useMemo(() => {
    const needle = clientQ.trim().toLowerCase();
    if (!needle) return clients.slice(0, 30);
    return clients.filter((c) => [c.name, c.system_id].join(' ').toLowerCase().includes(needle)).slice(0, 30);
  }, [clients, clientQ]);

  const canContinue = useMemo(() => {
    if (step === 1) return !!vendor;
    if (step === 2) {
      if (route === 'create-new') return newRoute.name.trim().length > 0;
      return !!route;
    }
    if (step === 3) return !!client;
    if (step === 4) {
      const n = Number(price);
      return price.trim() !== '' && Number.isFinite(n) && n >= 0;
    }
    return true;
  }, [step, vendor, route, newRoute.name, client, price]);

  async function save(): Promise<void> {
    if (!vendor || !client) return;
    setBusy(true); setErr('');
    try {
      let routeId: string;
      if (route === 'create-new') {
        const created = await api<{ route: RouteOpt }>('/routes', {
          method: 'POST',
          body: JSON.stringify({
            name: newRoute.name.trim(),
            channel: 'sms',
            client_ids: [client.id],
            country_id: newRoute.country_id || null,
            prefix: newRoute.prefix || null,
            sender_id: newRoute.sender_id || null,
            strategy: newRoute.strategy,
            status: newRoute.status,
            tps_limit: newRoute.tps ? Math.max(1, Number(newRoute.tps) || 0) : null,
            vendors: [{ vendor_id: vendor.id, priority: 1, weight: 100 }],
          }),
        });
        routeId = created.route.id;
      } else if (route) {
        routeId = (route as RouteOpt).id;
      } else {
        setErr('Select a route.');
        return;
      }
      const n = Number(price);
      try {
        await api(`/routes/${routeId}/client-rates`, {
          method: 'POST',
          body: JSON.stringify({ client_id: client.id, price_per_segment: n, currency: 'EUR' }),
        });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('already exists')) {
          // try patch: find existing rate id then patch
          const existing = await api<{ rates: Array<{ id: string; client_id: string }> }>(`/routes/${routeId}/client-rates`);
          const hit = existing.rates.find((r) => r.client_id === client.id);
          if (hit) {
            await api(`/routes/${routeId}/client-rates/${hit.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ price_per_segment: n }),
            });
          } else {
            throw e;
          }
        } else throw e;
      }
      if (sendRn) {
        try {
          setRnBusy(true);
          // Build rates for the notification: try full active-rate sample first
          let rates: unknown[] = [];
          try {
            const preview = await api<{ sample: Array<{ country:string; operator:string; mcc:string; mnc:string; rate:number; currency:string }>; empty:boolean }>(`/rate-notifications/attachment-preview/${client.id}?account_id=${encodeURIComponent(client.system_id)}&system_id=${encodeURIComponent(client.system_id)}`);
            if (!preview.empty && preview.sample?.length) {
              rates = preview.sample.map((r) => ({
                country: r.country, country_code: null, network_name: r.operator, mcc: r.mcc || '000', mnc: r.mnc || 'ALL', currency: r.currency || 'EUR', rate: Number(r.rate), billing_mode: 'on_submission', delivery_rate: null,
              }));
            }
          } catch {}
          if (!rates.length) {
            const routeName = route === 'create-new' ? newRoute.name.trim() : (route as RouteOpt | null)?.name ?? 'Route';
            const countryLabel = (route !== 'create-new' ? (route as RouteOpt | null)?.country_name : null) ?? countries.find((c) => c.id === newRoute.country_id)?.name ?? 'All Destinations';
            rates = [{ country: countryLabel, country_code: null, network_name: `${routeName} - Default`, mcc: '000', mnc: 'ALL', currency: 'EUR', rate: Number(price), billing_mode: 'on_submission', delivery_rate: null }];
          }
          const ccList = rnCc.split(/[;,]/).map((s)=>s.trim().toLowerCase()).filter(Boolean);
          const bccList = rnBcc.split(/[;,]/).map((s)=>s.trim().toLowerCase()).filter(Boolean);
          const vf = new Date(rnValidFrom);
          await api('/rate-notifications', {
            method: 'POST',
            body: JSON.stringify({ client_id: client.id, valid_from: vf.toISOString(), timezone: 'GMT', cc: ccList, bcc: bccList, include_attachment: rnIncludeAttachment, rates }),
          });
        } catch (e2) {
          setErr((e2 as Error).message);
          setBusy(false); setRnBusy(false);
          return;
        } finally { setRnBusy(false); }
      }
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const pct = (step / 5) * 100;

  return (
    <Modal title="Add route — step-by-step" onClose={onClose} wide>
      <div className="space-y-4">
        <StepIndicator step={step} />
        <div className="h-1 bg-line/40 rounded-full overflow-hidden">
          <div className="h-1 bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
        {err && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{err}</div>}

        {step === 1 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Step 1 — Select Vendor</div>
            <p className="text-xs text-muted">Pick the upstream vendor that will terminate this route.</p>
            <SearchInput value={vendorQ} onChange={setVendorQ} onSearch={() => undefined} placeholder="Search vendor name, system ID, host…" />
            <div className="border border-line/60 rounded-lg overflow-hidden max-h-[320px] overflow-y-auto">
              <table className="tbl">
                <thead><tr><th>Vendor</th><th className="!text-right">Active Routes</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {vendorList.map((v) => {
                    const sel = vendor?.id === v.id;
                    return (
                      <tr key={v.id} className={sel ? 'bg-brand/10' : ''}>
                        <td>
                          <div className="font-semibold">{v.name}</div>
                          <div className="text-[11px] text-muted font-mono">VND-{v.id.slice(0, 8).toUpperCase()} · {v.host ?? '—'}</div>
                        </td>
                        <td className="!text-right tabular-nums font-semibold">{Number(v.active_route_count ?? 0).toLocaleString()}</td>
                        <td><StatusBadge status={v.status ?? 'unknown'} /></td>
                        <td className="!text-right">
                          <button className={`btn-ghost !py-1 !px-3 !text-xs ${sel ? '!border-brand/50 !text-emerald-300' : ''}`} onClick={() => setVendor(v)}>
                            {sel ? '✓ Selected' : 'Select'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!vendorList.length && <div className="p-6 text-center text-sm text-muted">No vendors found.</div>}
            </div>
            {vendor && <div className="text-xs text-emerald-300">Selected: <b>{vendor.name}</b> · VND-{vendor.id.slice(0, 8).toUpperCase()}</div>}
          </div>
        )}

        {step === 2 && vendor && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Step 2 — Select Route for {vendor.name}</div>
            <p className="text-xs text-muted">Pick an existing route from this vendor, or create a new one inline.</p>
            <SearchInput value={routeQ} onChange={setRouteQ} onSearch={() => undefined} placeholder="Search route name, prefix, sender…" />
            <div className="border border-line/60 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
              <table className="tbl">
                <thead><tr><th>Route</th><th>Match</th><th className="!text-right">Price</th><th /></tr></thead>
                <tbody>
                  {routeList.map((r) => {
                    const sel = (route as RouteOpt | null)?.id === r.id;
                    return (
                      <tr key={r.id} className={sel ? 'bg-brand/10' : ''}>
                        <td>
                          <div className="font-semibold text-sky-300">{r.name}</div>
                          <div className="text-[11px] text-muted font-mono">{r.strategy} · {r.status}</div>
                        </td>
                        <td className="text-xs font-mono">{[r.country_name ?? 'any', r.prefix ? `prefix ${r.prefix}` : '', r.sender_id ? `sender ${r.sender_id}` : ''].filter(Boolean).join(' · ')}</td>
                        <td className="!text-right tabular-nums text-xs">{r.price_per_segment != null ? `${Number(r.price_per_segment).toFixed(4)} €` : '—'}</td>
                        <td className="!text-right">
                          <button className={`btn-ghost !py-1 !px-3 !text-xs ${sel ? '!border-brand/50 !text-emerald-300' : ''}`} onClick={() => setRoute(r)}>
                            {sel ? '✓ Selected' : 'Select'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!routeList.length && vendor && <div className="p-4 text-center text-sm text-muted">No routes for this vendor yet. Create one below.</div>}
            </div>
            <div className="rounded-lg border border-dashed border-line p-3 space-y-2 bg-ink/30">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={route === 'create-new'} onChange={() => setRoute('create-new')} className="accent-emerald-500" />
                <span className="font-semibold">+ Create new route for {vendor.name}</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={route !== 'create-new'} onChange={() => { if (route === 'create-new') setRoute(null); }} className="accent-emerald-500" />
                <span className="text-muted">Pick existing</span>
              </label>
              {route === 'create-new' && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="col-span-2">
                    <label className="label">Route name *</label>
                    <input className="input" placeholder="India Premium — this vendor" value={newRoute.name} onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Country</label>
                    <select className="input" value={newRoute.country_id} onChange={(e) => setNewRoute({ ...newRoute, country_id: e.target.value })}>
                      <option value="">All countries</option>
                      {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Prefix</label>
                    <input className="input font-mono" placeholder="91" value={newRoute.prefix} onChange={(e) => setNewRoute({ ...newRoute, prefix: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Sender</label>
                    <input className="input font-mono" placeholder="sender" value={newRoute.sender_id} onChange={(e) => setNewRoute({ ...newRoute, sender_id: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">TPS</label>
                    <input className="input font-mono" placeholder="blank = none" value={newRoute.tps} onChange={(e) => setNewRoute({ ...newRoute, tps: e.target.value })} inputMode="numeric" />
                  </div>
                  <div>
                    <label className="label">Strategy</label>
                    <select className="input font-mono !text-xs" value={newRoute.strategy} onChange={(e) => setNewRoute({ ...newRoute, strategy: e.target.value })} title={STRATEGY_HINT[newRoute.strategy]}>
                      {STRATEGIES.map(([v]) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select className="input" value={newRoute.status} onChange={(e) => setNewRoute({ ...newRoute, status: e.target.value })}>
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </div>
                  <div className="col-span-2 text-[11px] text-muted">{STRATEGY_HINT[newRoute.strategy]}</div>
                </div>
              )}
            </div>
            {route && route !== 'create-new' && <div className="text-xs text-emerald-300">Selected: <b>{(route as RouteOpt).name}</b></div>}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Step 3 — Select Client</div>
            <p className="text-xs text-muted">Choose which client this rate applies to.</p>
            <SearchInput value={clientQ} onChange={setClientQ} onSearch={() => undefined} placeholder="Search client name or system ID…" />
            <div className="border border-line/60 rounded-lg overflow-hidden max-h-[320px] overflow-y-auto">
              <table className="tbl">
                <thead><tr><th>Client</th><th>System ID</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {clientList.map((c) => {
                    const sel = client?.id === c.id;
                    return (
                      <tr key={c.id} className={sel ? 'bg-brand/10' : ''}>
                        <td className="font-medium">{c.name}</td>
                        <td className="font-mono text-xs text-muted">{c.system_id}</td>
                        <td><StatusBadge status={c.status} /></td>
                        <td className="!text-right">
                          <button className={`btn-ghost !py-1 !px-3 !text-xs ${sel ? '!border-brand/50 !text-emerald-300' : ''}`} onClick={() => setClient(c)}>
                            {sel ? '✓ Selected' : 'Select'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!clientList.length && <div className="p-6 text-center text-sm text-muted">No clients found.</div>}
            </div>
            {client && <div className="text-xs text-emerald-300">Selected: <b>{client.name}</b> · {client.system_id}</div>}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Step 4 — Set Rate (per-client route rate)</div>
            <p className="text-xs text-muted">Price this client pays on this route. Overrides the route default and the country rate card. EUR only.</p>
            <div>
              <label className="label">Price / segment (€) *</label>
              <div className="flex gap-1.5">
                <input className="input font-mono flex-1" placeholder="0.0045" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" autoFocus />
                <span className="input !w-auto text-muted">€ EUR</span>
              </div>
              {price.trim() !== '' && Number.isFinite(Number(price)) && Number(price) >= 0 && (
                <div className="text-xs text-muted mt-1">Preview: €{Number(price).toFixed(4)} × 1 seg = <b className="text-emerald-300">€{Number(price).toFixed(4)}</b></div>
              )}
              {price.trim() !== '' && (!Number.isFinite(Number(price)) || Number(price) < 0) && (
                <div className="text-xs text-red-300 mt-1">Enter a valid price ≥ 0.</div>
              )}
            </div>
          </div>
        )}

        {step === 5 && vendor && client && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Step 5 — Review & Save</div>
            <div className="rounded-lg border border-line bg-ink/50 p-4 space-y-2 text-sm">
              <div><span className="text-muted">Vendor:</span> <b>{vendor.name}</b> <span className="font-mono text-xs text-muted">VND-{vendor.id.slice(0, 8).toUpperCase()}</span> <StatusBadge status={vendor.status ?? 'unknown'} /></div>
              <div><span className="text-muted">Route:</span> {route === 'create-new' ? <span><b>{newRoute.name || '(new)'}</b> <span className="text-xs text-muted">— new route for {vendor.name}</span></span> : <b>{(route as RouteOpt | null)?.name ?? '—'}</b>}</div>
              <div><span className="text-muted">Client:</span> <b>{client.name}</b> <span className="font-mono text-xs text-muted">{client.system_id}</span></div>
              <div><span className="text-muted">Rate:</span> <b className="text-emerald-300">€{Number(price || 0).toFixed(4)} / seg</b> <span className="text-xs text-muted">EUR · per-client route override</span></div>
              <div className="text-[11px] text-muted pt-1 border-t border-line/50 mt-2">Priority: per-client route rate → route default → country rate card → 0. This rate wins.</div>
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/5 p-3 cursor-pointer">
              <input type="checkbox" checked={sendRn} onChange={(e) => setSendRn(e.target.checked)} className="mt-0.5 accent-emerald-500" />
              <span className="text-sm"><span className="font-semibold">You have set route for this client — send rate notification to this client now?</span><span className="block text-xs text-muted">Sends an RN email exactly like Rate Notifications (same mailer, same Excel attachment when checked). Unchecked = save rate only.</span></span>
            </label>
            {sendRn && (
              <div className="rounded-lg border border-line/60 p-3 space-y-2 bg-ink/30">
                <div>
                  <label className="label">Valid From (GMT)</label>
                  <input type="datetime-local" className="input max-w-[260px]" value={rnValidFrom} onChange={(e) => setRnValidFrom(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">CC (comma-separated)</label><input className="input font-mono !text-xs" placeholder="cc@example.com, ops@example.com" value={rnCc} onChange={(e) => setRnCc(e.target.value)} /></div>
                  <div><label className="label">BCC (comma-separated)</label><input className="input font-mono !text-xs" placeholder="audit@example.com" value={rnBcc} onChange={(e) => setRnBcc(e.target.value)} /></div>
                </div>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rnIncludeAttachment} onChange={(e) => setRnIncludeAttachment(e.target.checked)} /> Attach complete client rate Excel</label>
                <div className="flex gap-2 items-center flex-wrap">
                  <button className="btn-ghost !text-xs !py-1" disabled={rnBusy} onClick={async () => {
                    setRnBusy(true); setErr('');
                    try {
                      const ccList = rnCc.split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
                      const bccList = rnBcc.split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
                      let rates: unknown[] = [];
                      try {
                        const preview = await api<{ sample: Array<{ country: string; operator: string; mcc: string; mnc: string; rate: number; currency: string }>; empty: boolean }>(`/rate-notifications/attachment-preview/${client.id}?account_id=${encodeURIComponent(client.system_id)}&system_id=${encodeURIComponent(client.system_id)}`);
                        if (!preview.empty && preview.sample?.length) {
                          rates = preview.sample.slice(0, 1).map((r) => ({ country: r.country, country_code: null, network_name: r.operator, mcc: r.mcc || '000', mnc: r.mnc || 'ALL', currency: r.currency || 'EUR', rate: Number(r.rate), billing_mode: 'on_submission', delivery_rate: null }));
                        }
                      } catch { /* fallback below */ }
                      if (!rates.length) {
                        const routeName = route === 'create-new' ? newRoute.name.trim() : (route as RouteOpt | null)?.name ?? 'Route';
                        const countryLabel = (route !== 'create-new' ? (route as RouteOpt | null)?.country_name : null) ?? countries.find((c) => c.id === newRoute.country_id)?.name ?? 'All Destinations';
                        rates = [{ country: countryLabel, country_code: null, network_name: `${routeName} - Default`, mcc: '000', mnc: 'ALL', currency: 'EUR', rate: Number(price), billing_mode: 'on_submission', delivery_rate: null }];
                      }
                      const vf = new Date(rnValidFrom);
                      const pv = await api<{ to: string; cc: string[]; bcc: string[]; subject: string; html: string; attachment: { filename: string; route_count: number; countries: number; networks: number; empty: boolean; error?: string } | null }>('/rate-notifications/preview', { method: 'POST', body: JSON.stringify({ client_id: client.id, valid_from: vf.toISOString(), timezone: 'GMT', cc: ccList, bcc: bccList, include_attachment: rnIncludeAttachment, rates }) });
                      setRnPreview(pv);
                    } catch (e) { setErr((e as Error).message); }
                    setRnBusy(false);
                  }}>{rnBusy ? 'Working…' : 'Preview email'}</button>
                  {rnPreview && <span className="text-xs text-muted">To: <span className="mono">{rnPreview.to}</span> {rnPreview.attachment && !rnPreview.attachment.empty ? `· ${rnPreview.attachment.filename} (${rnPreview.attachment.route_count} routes)` : ''}</span>}
                </div>
                {rnPreview?.html && <div className="mt-2"><div className="label">Email preview</div><iframe title="rn-preview" className="w-full rounded-lg border border-line bg-white" style={{ height: 360 }} srcDoc={rnPreview.html} /></div>}
                {rnPreview?.attachment?.empty && rnIncludeAttachment && <div className="text-xs text-amber-300">No active rates — attachment will be omitted unless you uncheck the Excel box.</div>}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t border-line/60">
          {step > 1 && <button className="btn-ghost" onClick={() => setStep((s) => (s - 1) as typeof step)} disabled={busy}>Back</button>}
          <span className="flex-1" />
          {step < 5 ? (
            <button className="btn" onClick={() => setStep((s) => (s + 1) as typeof step)} disabled={!canContinue || busy}>
              Continue →
            </button>
          ) : (
            <button className="btn" onClick={() => void save()} disabled={!canContinue || busy}>
              {busy ? 'Saving…' : route === 'create-new' ? 'Create route & save rate' : 'Save rate'}
            </button>
          )}
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
