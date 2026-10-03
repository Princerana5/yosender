import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, EmptyState, Icon, SearchInput } from '../components';
import { RouteWizard } from './RouteWizard';
import { RouteDlrCuttingPanel } from './DlrCutting';

interface RouteVendor {
  vendor_id: string;
  vendor_name?: string;
  vendor_status?: string;
  priority: number;
  weight: number;
}

interface RouteMember {
  client_id: string;
  client_name: string;
  system_id: string;
}

interface Route {
  id: string; name: string; channel: string; strategy: string; status: string;
  client_id: string | null; // legacy single-owner column (kept in sync, not authoritative)
  client_name?: string | null;
  member_clients?: RouteMember[] | null;
  member_count?: string;
  country_id: string | null;
  country_name?: string | null;
  prefix: string | null;
  sender_id: string | null;
  tps_limit: number | null;
  price_per_segment: string | null;
  price_currency: string | null;
  internal_vendor_cost?: string | null;
  internal_cost_currency?: string | null;
  min_margin_pct: string | null;
  min_vendor_cost: string | null;
  margin_floor: number | null;
  below_margin: boolean;
  msgs_24h?: string;
  msgs_7d?: string;
  filter_refs?: string;
  policy_count?: string;
  vendors: RouteVendor[] | null;
  client_rates?: Array<{ price_per_segment: string; currency: string; pricing_mode?: string; client_name?: string; system_id?: string; client_id: string }>;
  route_client_rate_count?: string;
}

interface RouteDetail {
  route: Route & {
    delivered_7d?: string;
    exclusion_count?: string;
  };
  served_clients: Array<{ id: string; name: string; system_id: string }>;
  served_count: number;
  excluded: Array<{ id: string; name: string; system_id: string; excluded_at: string }>;
  available: Array<{ id: string; name: string; system_id: string }>;
}

// Scope helpers: global = no members · shared = 2+ members · dedicated = 1 member
function memberCount(r: Route): number {
  if (r.member_count !== undefined && r.member_count !== null) return Number(r.member_count);
  return r.member_clients?.length ?? (r.client_id ? 1 : 0);
}
function scopeOf(r: Route): 'global' | 'shared' | 'dedicated' {
  const n = memberCount(r);
  if (n === 0) return 'global';
  if (n === 1) return 'dedicated';
  return 'shared';
}
function ScopeBadge({ route, clients }: { route: Route; clients: Opt[] }): JSX.Element {
  const scope = scopeOf(route);
  if (scope === 'global') {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-panel2 text-muted border border-line">
        🌍 GLOBAL · all clients
      </span>
    );
  }
  const members = route.member_clients ?? [];
  const first = members[0];
  const firstName = first?.client_name ?? (route.client_id ? clients.find((c) => c.id === route.client_id)?.name ?? '1 client' : '1 client');
  if (scope === 'dedicated') {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand/10 text-emerald-300 border border-brand/25" title={first?.system_id ?? ''}>
        🎯 {firstName}
      </span>
    );
  }
  const extra = members.slice(1, 3).map((m) => m.client_name).join(', ');
  const rest = members.length - 3;
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/25"
      title={members.map((m) => `${m.client_name} (${m.system_id})`).join('\n')}>
      👥 {firstName}{extra ? `, ${extra}` : ''}{rest > 0 ? ` +${rest} more` : ''} · {members.length}
    </span>
  );
}

interface Opt {
  id: string;
  name: string;
  system_id?: string;
  iso_code?: string;
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

// ── OTP transformation panel (India HSP): one-screen setup ─────────────────
// Step 1: pick a template (or create one inline) · Step 2: flip ON · done.
// Fallbacks stay on safe defaults (reject with reason) unless changed.

interface OtpTemplateOpt {
  id: string; name: string; sender_id: string; status: string; is_default: boolean;
}

function OtpTransformPanel({ route, onChange }: {
  route: Route & {
    otp_transform_enabled?: boolean; otp_default_template_id?: string | null;
    otp_on_no_otp?: string; otp_on_no_template?: string;
  };
  onChange: () => void;
}): JSX.Element {
  const [templates, setTemplates] = useState<OtpTemplateOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const [draft, setDraft] = useState({ name: '', sender_id: '', content: '' });
  const enabled = !!route.otp_transform_enabled;

  const reloadTemplates = (): void => {
    api<{ templates: OtpTemplateOpt[] }>('/routes/otp-templates')
      .then((r) => setTemplates(r.templates))
      .catch(() => undefined);
  };
  useEffect(reloadTemplates, []);

  async function patch(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setErr('');
    try {
      await api(`/routes/${route.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // One-click setup: create template inline AND enable the route in one go.
  async function createAndEnable(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const t = await api<{ template: OtpTemplateOpt }>('/routes/otp-templates', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name, sender_id: draft.sender_id, content: draft.content,
          otp_placeholder: '{OTP}', status: 'active', is_default: false,
        }),
      });
      await api(`/routes/${route.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ otp_default_template_id: t.template.id, otp_transform_enabled: true }),
      });
      setShowNew(false);
      setDraft({ name: '', sender_id: '', content: '' });
      reloadTemplates();
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = templates.filter((t) => t.status === 'active');
  const current = templates.find((t) => t.id === route.otp_default_template_id);
  // Setup is complete when ON + a template is picked. Everything else is detail.
  const ready = enabled && !!route.otp_default_template_id;

  return (
    <div className={`rounded-lg border px-3 py-3 text-xs space-y-2.5 ${ready ? 'border-brand/30 bg-brand/[0.04]' : 'border-dashed border-line/60 bg-transparent'}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-widest uppercase text-muted">OTP Mode</span>
        {ready && <span className="text-[11px] text-emerald-300">· ON ✓</span>}
        {ready && (
          <button
            className="ml-auto text-[11px] font-medium border rounded-full px-3 py-1 border-brand/40 text-emerald-300 hover:bg-brand/10"
            disabled={busy}
            onClick={() => void patch({ otp_transform_enabled: false })}
          >
            Turn off
          </button>
        )}
      </div>

      {!ready ? (
        <div className="space-y-3">
          <p className="text-muted leading-relaxed">
            Client sends any Sender ID + any OTP text → you rewrite it to your approved template + Sender ID → HSP vendor.
          </p>
          <div>
            <label className="label">Step 1 — approved template</label>
            <div className="flex gap-2">
              <select
                className="input font-mono !text-xs flex-1"
                value={route.otp_default_template_id ?? ''}
                onChange={(e) => void patch({ otp_default_template_id: e.target.value || null })}
              >
                <option value="">— choose template —</option>
                {active.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {t.sender_id}{t.is_default ? ' ★' : ''}</option>
                ))}
              </select>
              <button className="btn-ghost !text-xs shrink-0" onClick={() => setShowNew((s) => !s)}>
                + New
              </button>
            </div>
          </div>
          {showNew && (
            <form onSubmit={(e) => void createAndEnable(e)} className="rounded-lg border border-line bg-ink/60 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className="input !text-xs" placeholder="Template name (e.g. Login OTP)" value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} required />
                <input className="input font-mono !text-xs" placeholder="Approved SID (e.g. MYBANK)" value={draft.sender_id}
                  onChange={(e) => setDraft({ ...draft, sender_id: e.target.value })} maxLength={21} required />
              </div>
              <textarea className="input !text-xs min-h-[60px]" placeholder="Template text with {OTP} — e.g. Your code is {OTP}. Valid 10 min." value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })} maxLength={1000} required />
              <div className="text-[11px] text-muted">Creating also flips OTP mode ON for this route.</div>
              <button className="btn w-full !py-1.5 !text-xs" type="submit" disabled={busy}>
                {busy ? 'Saving…' : '✓ Create + turn ON'}
              </button>
            </form>
          )}
          <div>
            <label className="label">Step 2 — turn it on</label>
            <button
              className="btn w-full !py-2"
              disabled={busy || !route.otp_default_template_id}
              title={!route.otp_default_template_id ? 'Pick a template first' : 'Start transforming OTP traffic on this route'}
              onClick={() => void patch({ otp_transform_enabled: true })}
            >
              {busy ? 'Saving…' : '⚡ Turn ON OTP mode'}
            </button>
            {!route.otp_default_template_id && (
              <div className="text-[11px] text-amber-300 mt-1">Pick (or create) a template first — then turn it on.</div>
            )}
          </div>
          {err && <div className="text-xs text-red-300">{err}</div>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs">
            Vendor receives <b className="font-mono text-gray-200">{current?.sender_id ?? '…'}</b>
            {' '}with “{current?.name ?? '…'}” — no matter what SID/text the client sends.
          </div>
          <div className="flex gap-2">
            <select
              className="input font-mono !text-xs flex-1"
              value={route.otp_default_template_id ?? ''}
              onChange={(e) => void patch({ otp_default_template_id: e.target.value || null })}
              title="Swap template"
            >
              {active.map((t) => (
                <option key={t.id} value={t.id}>{t.name} · {t.sender_id}{t.is_default ? ' ★' : ''}</option>
              ))}
            </select>
            <button className="btn-ghost !text-xs shrink-0" onClick={() => setShowAdv((s) => !s)}>
              {showAdv ? 'Hide options' : 'Options'}
            </button>
          </div>
          {showAdv && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">If OTP not found</label>
                <select
                  className="input !text-xs"
                  value={route.otp_on_no_otp ?? 'reject'}
                  onChange={(e) => void patch({ otp_on_no_otp: e.target.value })}
                >
                  <option value="reject">Reject with reason</option>
                  <option value="passthrough">Send normally</option>
                </select>
              </div>
              <div>
                <label className="label">If no template</label>
                <select
                  className="input !text-xs"
                  value={route.otp_on_no_template ?? 'reject'}
                  onChange={(e) => void patch({ otp_on_no_template: e.target.value })}
                >
                  <option value="reject">Reject with reason</option>
                  <option value="passthrough">Send normally</option>
                </select>
              </div>
            </div>
          )}
          {err && <div className="text-xs text-red-300">{err}</div>}
        </div>
      )}
    </div>
  );
}

// ── Member manager: dedicated/shared routes — read list + remove only. Adding is done in Client rates above.
function MemberManager({ detail, onChange, setDetail }: {
  detail: RouteDetail; clients: Opt[]; onChange: () => void; setDetail: (d: RouteDetail | null) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function remove(c: { id: string; name: string }): Promise<void> {
    const remaining = detail.served_clients.length - 1;
    const warn = remaining === 0
      ? `\n\nThis is the LAST member — the route becomes global for other clients, but ${c.name} will be excluded. Their route-specific rates are deleted.`
      : `\n\nTheir route-specific rates are deleted along with access.`;
    if (!window.confirm(`Remove ${c.name} from "${detail.route.name}"?${warn}`)) return;
    setBusy(true);
    try {
      await api(`/routes/${detail.route.id}/members/${c.id}`, { method: 'DELETE' });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted">Route access</h4>
        <span className="text-[11px] text-muted">· {detail.served_clients.length} client{detail.served_clients.length === 1 ? '' : 's'} can use this route</span>
      </div>
      <p className="text-[11px] text-muted mb-2 leading-relaxed">Managed in <b className="text-gray-400">Client rates</b> above — adding a rate grants access automatically. Remove here revokes access and deletes that client’s route-specific rates.</p>
      <div className="space-y-1 max-h-36 overflow-y-auto">
        {detail.served_clients.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-sm border border-line/60 rounded-lg px-3 py-1.5 bg-ink/20">
            <Link className="font-semibold text-sky-300 hover:underline" to={`/clients/${c.id}`} onClick={() => setDetail(null)}>{c.name}</Link>
            <span className="text-[11px] text-muted font-mono">{c.system_id}</span>
            <button className="text-[11px] text-muted hover:text-red-300 ml-auto" disabled={busy}
              title={`Remove ${c.name} from this route`}
              onClick={() => remove(c)}>
              Remove
            </button>
          </div>
        ))}
        {!detail.served_clients.length && <div className="text-xs text-muted border border-dashed border-line/60 rounded-lg px-3 py-3 text-center">No clients — add a rate above to grant access, or route is global.</div>}
      </div>
    </div>
  );
}

// ── Vendor Rates panel (admin-only cost layer) ─────────────────────────────
function RouteVendorRatesPanel({ routeId, chain, vendors }: { routeId: string; chain: RouteVendor[] | null; vendors: Opt[] }): JSX.Element {
  const [data, setData] = useState<{ route: { internal_vendor_cost: string | null; internal_cost_currency: string | null }; vendor_ids: string[]; rates: Array<{ id: string; vendor_id: string; vendor_name: string; country_name: string | null; iso_code: string | null; prefix: string | null; operator: string | null; cost: string; currency: string; updated_at: string }> } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api<typeof data>(`/routes/${routeId}/vendor-rates`).then(setData).catch(() => undefined).finally(() => setLoading(false));
  }, [routeId]);
  if (loading) return <div className="text-xs text-muted py-3 text-center">Loading costs…</div>;
  if (!data) return <div className="text-xs text-muted py-3 text-center">Could not load vendor rates.</div>;
  const fallback = data.route.internal_vendor_cost != null ? `${Number(data.route.internal_vendor_cost).toFixed(4)} ${data.route.internal_cost_currency ?? 'EUR'}` : null;
  const chainSorted = [...(chain ?? [])].sort((a, b) => a.priority - b.priority);
  const ratesByVendor = new Map<string, typeof data.rates>();
  for (const r of data.rates) {
    const arr = ratesByVendor.get(r.vendor_id) ?? [];
    arr.push(r);
    ratesByVendor.set(r.vendor_id, arr);
  }
  const resolveName = (id: string): string => vendors.find((v) => v.id === id)?.name ?? data.rates.find((r) => r.vendor_id === id)?.vendor_name ?? id.slice(0, 8);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted">Vendor cost</h4>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">Admin only</span>
        <span className="text-[11px] text-muted">{chainSorted.length} vendor{chainSorted.length === 1 ? '' : 's'}</span>
        {fallback && <span className="ml-auto font-mono text-xs text-muted">Fallback {fallback}</span>}
      </div>
      {!chainSorted.length ? (
        <div className="rounded-lg border border-dashed border-line/60 bg-ink/30 px-4 py-3 text-xs text-muted text-center">No vendors on this route — add one in <b className="text-gray-300">Vendors &amp; distribution</b> below.</div>
      ) : data.rates.length === 0 ? (
        <div className="rounded-lg border border-line bg-ink/20 divide-y divide-line/30">
          {chainSorted.map((v) => (
            <div key={v.vendor_id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="text-xs font-medium min-w-[140px]">{resolveName(v.vendor_id)} <span className="ml-1 text-[10px] font-mono text-muted">P{v.priority} · {v.weight}%</span></span>
              <span className="text-xs text-muted">No rate configured</span>
              <a href="/vendors" className="ml-auto text-xs font-medium text-brand hover:text-brand/80">Set in Vendors →</a>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="bg-ink/40 text-[10px] tracking-widest uppercase text-muted"><th className="text-left font-semibold py-2 px-3">Vendor</th><th className="text-left font-semibold py-2 px-3">Destination</th><th className="text-right font-semibold py-2 px-3">Cost / seg</th><th className="text-right font-semibold py-2 px-3">Updated</th></tr></thead>
            <tbody className="divide-y divide-line/30">
              {chainSorted.flatMap((v) => {
                const rows = ratesByVendor.get(v.vendor_id) ?? [];
                if (!rows.length) return [{ _empty: true, vendor: v } as unknown as typeof rows[0]];
                return rows;
              }).map((r: unknown) => {
                const er = r as { _empty?: boolean; vendor?: RouteVendor; id?: string; vendor_id?: string; vendor_name?: string; country_name?: string | null; iso_code?: string | null; prefix?: string | null; operator?: string | null; cost?: string; currency?: string; updated_at?: string };
                if (er._empty) {
                  const v = er.vendor!;
                  return (
                    <tr key={`empty-${v.vendor_id}`}>
                      <td className="py-2.5 px-3 font-medium">{resolveName(v.vendor_id)} <span className="text-[10px] font-mono text-muted ml-1">P{v.priority}</span></td>
                      <td className="py-2.5 px-3 text-muted">— no rate</td>
                      <td className="py-2.5 px-3 text-right text-muted">—</td>
                      <td className="py-2.5 px-3 text-right"><a className="text-brand hover:underline text-xs font-medium" href="/vendors">Set →</a></td>
                    </tr>
                  );
                }
                return (
                  <tr key={er.id} className="hover:bg-panel/40">
                    <td className="py-2 px-3 font-medium">{er.vendor_name}</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-muted">{er.country_name ?? 'Any'}{er.iso_code ? ` · ${er.iso_code}` : ''}{er.prefix ? ` · ${er.prefix}` : ''}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{Number(er.cost!).toFixed(4)} <span className="text-muted font-normal">{er.currency}</span></td>
                    <td className="py-2 px-3 text-right text-muted">{er.updated_at ? new Date(er.updated_at).toLocaleDateString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.rates.length === 0 && chainSorted.length > 0 && <p className="text-[11px] text-muted leading-relaxed">Costs are set per vendor in <b>Vendors → Rates</b>. Until then the route <span className="font-mono">Fallback</span> above is used.</p>}
    </div>
  );
}

// ── Client Rates panel (per-client selling prices) ─────────────────────
// Country is the route's country — we don't ask again. Adding a rate also
// adds the client as a route member (if route isn't global) so both lists stay in sync.
function RouteClientRatesPanel({ routeId, routeCountryId, onChanged, minVendorCost }: { routeId: string; routeCountryId: string | null; onChanged: () => void; minVendorCost: string | null }): JSX.Element {
  const [rates, setRates] = useState<Array<{ id: string; client_id: string; client_name: string; system_id: string; country_name: string | null; iso_code: string | null; price_per_segment: string; currency: string; pricing_mode: string; markup_value: string | null; margin: number | null; margin_pct: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ client_id: '', price: '', currency: 'EUR', pricing_mode: 'direct' as string, markup_value: '', sameAsId: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const reload = (): void => {
    setLoading(true);
    api<{ rates: typeof rates }>(`/routes/${routeId}/client-rates`).then((r) => setRates(r.rates)).catch(() => undefined).finally(() => setLoading(false));
  };
  useEffect(reload, [routeId]);
  useEffect(() => {
    api<{ clients: typeof clients }>('/clients').then((r) => setClients(r.clients)).catch(() => undefined);
  }, []);
  async function add(): Promise<void> {
    setErr('');
    if (!form.client_id) { setErr('Pick a client.'); return; }
    let priceToUse = form.price;
    let currencyToUse = form.currency;
    let modeToUse = form.pricing_mode;
    let markupToUse = form.markup_value;
    if (form.sameAsId) {
      const src = rates.find((r) => r.id === form.sameAsId);
      if (!src) { setErr('Source rate not found.'); return; }
      priceToUse = String(src.price_per_segment);
      currencyToUse = src.currency;
      modeToUse = src.pricing_mode ?? 'direct';
      markupToUse = src.markup_value ?? '';
    } else {
      if (form.pricing_mode === 'direct' && (!form.price || Number(form.price) < 0)) { setErr('Price must be ≥ 0.'); return; }
      if (form.pricing_mode !== 'direct' && !form.markup_value) { setErr('Markup value required.'); return; }
    }
    setBusy(true);
    try {
      await api(`/routes/${routeId}/client-rates`, { method: 'POST', body: JSON.stringify({ client_id: form.client_id, country_id: routeCountryId, price_per_segment: modeToUse === 'direct' ? Number(priceToUse) : null, currency: currencyToUse, pricing_mode: modeToUse, markup_value: markupToUse ? Number(markupToUse) : null }) });
      // keep membership in sync so the Members list below reflects it (no-op on global routes)
      try { await api(`/routes/${routeId}/members`, { method: 'POST', body: JSON.stringify({ client_id: form.client_id }) }); } catch { /* global or already member */ }
      setShowAdd(false); setForm({ client_id: '', price: '', currency: 'EUR', pricing_mode: 'direct', markup_value: '', sameAsId: '' });
      reload(); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function saveEdit(id: string): Promise<void> {
    const n = Number(editPrice);
    if (!Number.isFinite(n) || n < 0) { setErr('Price must be ≥ 0.'); return; }
    setBusy(true); setErr('');
    try { await api(`/routes/${routeId}/client-rates/${id}`, { method: 'PATCH', body: JSON.stringify({ price_per_segment: n }) }); setEditingId(null); reload(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(id: string): Promise<void> {
    if (!window.confirm('Delete this client rate? Client keeps route access until removed from Members.')) return;
    await api(`/routes/${routeId}/client-rates/${id}`, { method: 'DELETE' });
    reload(); onChanged();
  }
  if (loading) return <div className="text-xs text-muted py-3 text-center">Loading client rates…</div>;
  const cost = minVendorCost != null ? Number(minVendorCost) : null;
  const addable = clients.filter((c) => !rates.some((r) => r.client_id === c.id));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted">Client rates</h4>
        <span className="text-[11px] text-muted">{rates.length} client{rates.length === 1 ? '' : 's'} · each can have its own price</span>
        <button className="ml-auto text-xs font-medium border border-line rounded-full px-3 py-1 hover:border-brand/40 hover:text-white transition" onClick={() => setShowAdd((s) => !s)}>{showAdd ? 'Close' : '+ Add rate'}</button>
      </div>
      {showAdd && (
        <div className="rounded-lg border border-line bg-ink/30 p-3 space-y-2.5">
          <select className="input !text-xs" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">— pick client —</option>
            {addable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {addable.length === 0 && rates.length > 0 && <div className="text-[11px] text-amber-300">All clients already have a rate on this route.</div>}
          {rates.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[11px] text-muted">Rate for this client</div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setForm({ ...form, sameAsId: '' })} className={`flex-1 text-xs py-1.5 rounded-lg border font-medium ${!form.sameAsId ? 'border-brand/40 bg-brand/10 text-white' : 'border-line text-muted hover:text-white'}`}>Different rate</button>
                <button type="button" onClick={() => setForm({ ...form, sameAsId: rates[0]?.id ?? '' })} className={`flex-1 text-xs py-1.5 rounded-lg border font-medium ${form.sameAsId ? 'border-brand/40 bg-brand/10 text-white' : 'border-line text-muted hover:text-white'}`}>Same as …</button>
              </div>
              {form.sameAsId ? (
                <select className="input !text-xs" value={form.sameAsId} onChange={(e) => setForm({ ...form, sameAsId: e.target.value })}>
                  {rates.map((r) => <option key={r.id} value={r.id}>{r.client_name} — {Number(r.price_per_segment).toFixed(4)} {r.currency}</option>)}
                </select>
              ) : (
                <>
                  <div className="flex gap-2">
                    <select className="input !text-xs flex-1" value={form.pricing_mode} onChange={(e) => setForm({ ...form, pricing_mode: e.target.value })}>
                      <option value="direct">Direct price</option>
                      <option value="percent_markup">% markup</option>
                      <option value="fixed_markup">Fixed markup</option>
                    </select>
                    <select className="input !text-xs w-[90px]" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                      <option value="EUR">EUR</option><option value="USD">USD</option>
                    </select>
                  </div>
                  {form.pricing_mode === 'direct' ? (
                    <input className="input font-mono !text-xs" placeholder="Price / seg  e.g. 0.0020" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
                  ) : (
                    <input className="input font-mono !text-xs" placeholder={form.pricing_mode === 'percent_markup' ? 'Markup %  e.g. 35' : 'Markup  e.g. 0.0010'} value={form.markup_value} onChange={(e) => setForm({ ...form, markup_value: e.target.value })} inputMode="decimal" />
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <select className="input !text-xs flex-1" value={form.pricing_mode} onChange={(e) => setForm({ ...form, pricing_mode: e.target.value })}>
                  <option value="direct">Direct price</option>
                  <option value="percent_markup">% markup</option>
                  <option value="fixed_markup">Fixed markup</option>
                </select>
                <select className="input !text-xs w-[90px]" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option value="EUR">EUR</option><option value="USD">USD</option>
                </select>
              </div>
              {form.pricing_mode === 'direct' ? (
                <input className="input font-mono !text-xs" placeholder="Price / seg  e.g. 0.0020" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
              ) : (
                <input className="input font-mono !text-xs" placeholder={form.pricing_mode === 'percent_markup' ? 'Markup %  e.g. 35' : 'Markup  e.g. 0.0010'} value={form.markup_value} onChange={(e) => setForm({ ...form, markup_value: e.target.value })} inputMode="decimal" />
              )}
            </>
          )}
          {err && <div className="text-xs text-red-300">{err}</div>}
          <button className="btn w-full !py-2 !text-xs" disabled={busy || !form.client_id} onClick={() => void add()}>{busy ? 'Saving…' : 'Save rate'}</button>
          <p className="text-[11px] text-muted text-center">Country = route's country · adding a rate also grants route access (shown in Members below).</p>
        </div>
      )}
      {!rates.length ? (
        <div className="rounded-lg border border-dashed border-line/60 bg-ink/20 px-4 py-4 text-center text-xs text-muted">No client rates yet — each client on this route can have its own price. Use <b className="text-gray-300">+ Add rate</b> above.</div>
      ) : (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="bg-ink/40 text-[10px] tracking-widest uppercase text-muted"><th className="text-left font-semibold py-2 px-3">Client</th><th className="text-right font-semibold py-2 px-3">Price</th><th className="text-right font-semibold py-2 px-3">Margin</th><th className="w-16"></th></tr></thead>
            <tbody className="divide-y divide-line/30">
              {rates.map((r) => (
                <tr key={r.id} className="hover:bg-panel/30">
                  <td className="py-2.5 px-3">
                    <div className="font-medium leading-none">{r.client_name}</div>
                    <div className="font-mono text-[10px] text-muted mt-0.5">{r.system_id}{r.country_name ? ` · ${r.country_name}` : ''}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {editingId === r.id ? (
                      <span className="flex gap-1 justify-end items-center"><input className="input !py-1 !px-2 !w-24 font-mono text-xs" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} inputMode="decimal" autoFocus /><button className="text-xs font-bold text-brand hover:underline" disabled={busy} onClick={() => void saveEdit(r.id)}>Save</button><button className="text-xs text-muted hover:text-white" onClick={() => setEditingId(null)}>×</button></span>
                    ) : (
                      <span className="font-mono font-semibold">{Number(r.price_per_segment).toFixed(4)} <span className="text-muted font-normal text-[10px]">{r.currency}</span></span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs">{r.margin != null ? <span className={r.margin < 0 ? 'text-red-300' : 'text-emerald-300'}>{r.margin > 0 ? '+' : ''}{r.margin.toFixed(4)} {r.margin_pct != null ? `(${r.margin_pct > 0 ? '+' : ''}${r.margin_pct}%)` : ''}</span> : cost != null ? <span className="text-muted">{(Number(r.price_per_segment) - cost).toFixed(4)}</span> : <span className="text-muted">—</span>}</td>
                  <td className="py-2.5 px-3 text-right"><span className="flex gap-1 justify-end">{editingId !== r.id && <button className="text-[11px] text-muted hover:text-white" onClick={() => { setEditingId(r.id); setEditPrice(String(r.price_per_segment)); }}>Edit</button>}<button className="text-[11px] text-muted hover:text-red-300" onClick={() => void remove(r.id)}>Del</button></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && !showAdd && <div className="text-xs text-red-300">{err}</div>}
    </div>
  );
}

// ── Vendor distribution editor (Detail drawer): add/remove vendors, weight Σ100 ──
function VendorDistributionEditor({ detail, vendors, onSaved }: {
  detail: RouteDetail; vendors: Opt[]; onSaved: () => void;
}): JSX.Element {
  const chain = (detail.route.vendors ?? []) as RouteVendor[];
  const [strategy, setStrategy] = useState(detail.route.strategy ?? 'priority');
  const [rows, setRows] = useState<Array<{ vendor_id: string; weight: number; priority: number }>>(
    chain.length ? chain.map((v) => ({ vendor_id: v.vendor_id, weight: v.weight ?? 100, priority: v.priority })) : [],
  );
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const total = rows.reduce((s, r) => s + (r.weight ?? 0), 0);
  const over = strategy === 'percentage' && rows.length > 1 && total !== 100;
  useEffect(() => {
    setStrategy(detail.route.strategy ?? 'priority');
    setRows(chain.length ? chain.map((v) => ({ vendor_id: v.vendor_id, weight: v.weight ?? 100, priority: v.priority })) : []);
    setAddId(''); setErr('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.route.id]);
  const used = new Set(rows.map((r) => r.vendor_id));
  const available = vendors.filter((v) => !used.has(v.id));
  const vendorName = (id: string): string => vendors.find((v) => v.id === id)?.name ?? id.slice(0, 8);
  async function save(): Promise<void> {
    setErr('');
    if (!rows.length) { setErr('Add at least one vendor.'); return; }
    if (over) { setErr(`Weights must total 100% (now Σ ${total}%). Fix before saving.`); return; }
    setBusy(true);
    try {
      await api(`/routes/${detail.route.id}`, { method: 'PATCH', body: JSON.stringify({ strategy, vendors: rows }) });
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  function evenSplit(): void {
    if (!rows.length) return;
    const base = Math.floor(100 / rows.length);
    const rem = 100 - base * rows.length;
    setRows(rows.map((r, i) => ({ ...r, weight: base + (i < rem ? 1 : 0) })));
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-[11px] font-bold tracking-widest uppercase text-muted">Vendors &amp; distribution</h4>
        {strategy === 'percentage' && <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${over ? 'bg-red-500/10 text-red-300 border-red-500/20' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>Σ {total}%{over ? ' — must be 100' : ''}</span>}
        {strategy === 'percentage' && rows.length > 1 && <button className="ml-auto text-[11px] text-muted hover:text-white" disabled={busy} onClick={evenSplit}>Even split</button>}
      </div>
      <div className="flex gap-2">
        <select className="input !py-1.5 !text-xs flex-1" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          <option value="priority">Priority — failover order</option>
          <option value="percentage">Weighted — percentage split</option>
          <option value="round_robin">Round robin</option>
          <option value="least_cost">Least cost</option>
          <option value="failover">Failover</option>
        </select>
      </div>
      {strategy === 'percentage' && rows.length > 1 && <p className="text-[11px] text-muted">Set weights to total 100% — engine picks a vendor per message by weight.</p>}
      {rows.length ? (
        <div className="space-y-2">
          {strategy === 'percentage' && (
            <div className="h-1.5 rounded-full overflow-hidden flex bg-ink border border-line/60">
              {rows.sort((a,b)=>a.priority-b.priority).map((r,i)=> (
                <div key={r.vendor_id} className={['bg-sky-500','bg-emerald-500','bg-amber-500','bg-violet-500','bg-rose-500'][i%5]!} style={{ width: `${Math.max(0, Math.min(100, (r.weight/Math.max(1,total))*100))}%` }} title={`${vendorName(r.vendor_id)} ${r.weight}%`} />
              ))}
            </div>
          )}
          {rows.sort((a,b)=>a.priority-b.priority).map((r,i)=> (
            <div key={r.vendor_id} className="flex items-center gap-2 rounded-lg border border-line/40 bg-ink/20 px-3 py-2">
              <span className={`w-1.5 h-8 rounded-full shrink-0 ${['bg-sky-500','bg-emerald-500','bg-amber-500','bg-violet-500','bg-rose-500'][i%5]}`} />
              <span className="text-xs font-medium min-w-[110px] truncate">{vendorName(r.vendor_id)}</span>
              <label className="flex items-center gap-1 text-[11px] text-muted">P <input className="input !py-1 !px-2 !w-12 font-mono text-xs" type="number" min={1} value={r.priority} onChange={(e)=>setRows(rows.map((x)=>x.vendor_id===r.vendor_id?{...x, priority: Math.max(1, Number(e.target.value)||1)}:x))} /></label>
              {strategy === 'percentage' ? (
                <label className="flex items-center gap-1 text-[11px] text-muted">% <input className="input !py-1 !px-2 !w-16 font-mono text-xs" type="number" min={0} max={100} value={r.weight} onChange={(e)=>setRows(rows.map((x)=>x.vendor_id===r.vendor_id?{...x, weight: Math.max(0, Math.min(100, Number(e.target.value)||0))}:x))} /></label>
              ) : <span className="text-[11px] text-muted">P{r.priority}</span>}
              <button className="text-[11px] text-muted hover:text-red-300 ml-auto" disabled={busy} onClick={()=>setRows(rows.filter((x)=>x.vendor_id!==r.vendor_id))}>Remove</button>
            </div>
          ))}
        </div>
      ) : <div className="text-xs text-muted border border-dashed border-line/60 rounded-lg px-3 py-3 text-center">No vendors — add one below.</div>}
      <div className="flex gap-2">
        <select className="input !py-1.5 !text-xs flex-1" value={addId} onChange={(e)=>setAddId(e.target.value)}>
          <option value="">+ Add vendor…</option>
          {available.map((v)=><option key={v.id} value={v.id}>{v.name} · {v.system_id ?? v.id.slice(0,8)}</option>)}
        </select>
        <button className="text-xs font-medium border border-line rounded-lg px-3 hover:border-brand/30" disabled={!addId || busy} onClick={()=>{ if(!addId) return; const nextP = rows.length ? Math.max(...rows.map((r)=>r.priority))+1 : 1; const remain = strategy==='percentage' && rows.length ? Math.max(0, 100-total) : 50; setRows([...rows, { vendor_id: addId, weight: rows.length===0?100:remain||Math.floor(100/(rows.length+1)), priority: nextP }]); setAddId(''); }}>Add</button>
      </div>
      <div className="flex justify-end"><button className="btn !py-1.5 !text-xs" disabled={busy || !rows.length || over} onClick={save}>{busy?'Saving…':'Save distribution'}</button></div>
      {err && <div className="text-xs text-red-300">{err}</div>}
      {!err && over && <div className="text-xs text-amber-300">Fix Σ to 100% first (Even split).</div>}
    </div>
  );
}

export default function Routes(): JSX.Element {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [vendors, setVendors] = useState<Opt[]>([]);
  const [countries, setCountries] = useState<Opt[]>([]);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'global' | 'shared' | 'dedicated'>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all');
  const [showWizard, setShowWizard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Route | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCurrency, setEditCurrency] = useState('EUR');
  const [editMargin, setEditMargin] = useState('');
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return routes.filter((r) => {
      if (scope !== 'all' && scopeOf(r) !== scope) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (!needle) return true;
      const hay = [
        r.name, r.strategy, r.channel, r.prefix ?? '', r.sender_id ?? '',
        ...(r.member_clients ?? []).map((m) => `${m.client_name} ${m.system_id}`),
        r.country_name ?? '',
        ...(r.vendors ?? []).map((v) => v.vendor_name ?? vendorName(v.vendor_id)),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [routes, q, scope, status, vendors]);

  const counts = useMemo(() => ({
    all: routes.length,
    global: routes.filter((r) => scopeOf(r) === 'global').length,
    shared: routes.filter((r) => scopeOf(r) === 'shared').length,
    dedicated: routes.filter((r) => scopeOf(r) === 'dedicated').length,
    active: routes.filter((r) => r.status === 'active').length,
  }), [routes]);

  function toggleVendor(id: string): void {
    // kept for compatibility if referenced elsewhere; wizard owns vendor selection
    void id;
  }

  function openModal(): void {
    setShowWizard(true);
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
      multiple clients move to a type-to-confirm step; member routes (1..N
      clients, never served anyone else) delete with a single confirm. */
  async function askDelete(r: Route): Promise<void> {
    setDeleteErr('');
    setDeleteTyped('');
    if (scopeOf(r) !== 'global') {
      const n = memberCount(r);
      const who = (r.member_clients ?? []).map((m) => m.client_name).join(', ') || `${n} client${n === 1 ? '' : 's'}`;
      if (!window.confirm(`Delete route "${r.name}" for ${who}? Traffic falls back to global routes. This cannot be undone.`)) return;
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
            ['shared', `👥 Shared (${counts.shared})`],
            ['dedicated', `🎯 1 client (${counts.dedicated})`],
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
                  <div className="flex items-center gap-2">
                    <button className="font-semibold text-sky-300 hover:text-sky-200 hover:underline text-left"
                      onClick={() => openDetail(r.id)} title="Open route detail">
                      {r.name}
                    </button>
                    {(r as { route_code?: string }).route_code && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ink border border-line text-muted" title="Route Code (business key)">
                        {(r as { route_code?: string }).route_code}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <ScopeBadge route={r} clients={clients} />
                    <span className="text-[11px] text-muted font-mono">{r.strategy}</span>
                    {(r as { route_type?: string }).route_type && <span className="text-[10px] px-1 py-0.5 rounded border border-line/60 text-muted">{(r as { route_type?: string }).route_type}</span>}
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
                  {[...r.vendors].sort((a, b) => a.priority - b.priority).slice(0, 2).map((v, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted">→</span>}
                      <span className={`font-mono text-[11px] border rounded px-1.5 py-0.5 ${v.vendor_status && v.vendor_status !== 'enabled' ? 'bg-danger/10 text-red-300 border-danger/30' : 'bg-panel2 border-line'}`}
                        title={v.vendor_name ?? vendorName(v.vendor_id)}>
                        {v.vendor_name ?? vendorName(v.vendor_id)} · P{v.priority}
                        {r.strategy === 'percentage' ? ` · ${v.weight}%` : ''}
                      </span>
                    </span>
                  ))}
                  {(r.vendors?.length ?? 0) > 2 && <span className="text-[11px] text-muted">+{(r.vendors?.length ?? 0) - 2}</span>}
                </span>
              ) : <span className="text-red-300 text-xs">⚠ no vendors</span>,
            },
            {
              key: 'vendor_cost', label: 'Vendor cost', right: true,
              render: (r) => {
                const cost = r.min_vendor_cost != null ? Number(r.min_vendor_cost) : (r.internal_vendor_cost != null ? Number(r.internal_vendor_cost) : null);
                if (cost == null) return <span className="text-xs text-muted">—</span>;
                const fx = (r as { internal_cost_currency?: string | null }).internal_cost_currency ?? 'EUR';
                return <span className="tabular-nums text-xs font-mono font-semibold text-amber-200" title="Cheapest vendor cost on this route (admin only)">{cost.toFixed(4)} <span className="text-[10px] text-muted">{fx}</span></span>;
              },
            },
            {
              key: 'client_rates', label: 'Client rates', right: true,
              render: (r) => {
                const cr = r.client_rates ?? [];
                if (cr.length) {
                  const tip = cr.map((x) => `${x.client_name ?? x.system_id ?? ''}: ${Number(x.price_per_segment).toFixed(4)} ${x.currency ?? 'EUR'}`).join('\n');
                  return (
                    <button className="text-right hover:opacity-80" title={`${tip}\n— click to manage`} onClick={() => openDetail(r.id)}>
                      <div className="tabular-nums text-xs font-semibold text-emerald-300">{cr.length} client{cr.length === 1 ? '' : 's'}</div>
                      <div className="tabular-nums text-[11px] text-muted truncate max-w-[160px]">{cr.slice(0, 2).map((x) => `${x.client_name ?? x.system_id} ${Number(x.price_per_segment).toFixed(4)}`).join(' · ')}{cr.length > 2 ? ` +${cr.length - 2}` : ''}</div>
                    </button>
                  );
                }
                if (r.price_per_segment != null) {
                  return <button className={`tabular-nums text-xs font-semibold hover:underline ${r.below_margin ? 'text-red-300' : 'text-muted'}`} title="Fallback price — click to set per-client rates" onClick={() => openDetail(r.id)}>{Number(r.price_per_segment).toFixed(4)} <span className="text-[10px]">{r.price_currency ?? 'EUR'}</span> <span className="text-[10px] text-muted">fallback</span></button>;
                }
                return <button className="text-xs text-muted hover:text-white" onClick={() => openDetail(r.id)}>— set</button>;
              },
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
              key: 'status', label: 'Status',
              render: (r) => {
                const on = !!(r as { otp_transform_enabled?: boolean }).otp_transform_enabled;
                return <span className="flex items-center gap-1.5"><StatusBadge status={r.status} /><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${on ? 'border-brand/40 bg-brand/10 text-emerald-300' : 'border-line text-muted'}`} title={on ? 'OTP ON' : 'OTP OFF'}>{on ? '⚡ ON' : 'OFF'}</span></span>;
              },
            },
            {
              key: 'actions', label: '', right: true,
              render: (r) => (
                <span className="flex gap-1 justify-end">
                  <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => openDetail(r.id)}>Detail</button>
                  <button className="btn-ghost !px-2 !py-1 text-red-300 hover:text-red-200" title="Delete" onClick={() => askDelete(r)}><Icon name="trash" size={14} /></button>
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
                <ScopeBadge route={detail.route} clients={clients} />
                {scopeOf(detail.route) === 'global' && (
                  <span className="text-[11px] text-muted">serves {detail.served_count} client{detail.served_count === 1 ? '' : 's'}</span>
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
              <div className="divide-y divide-line/40 -mx-1">
                <div className="px-1 pb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span><span className="text-muted">Matches</span> <span className="font-mono font-medium">{[detail.route.country_name ?? 'Any country', detail.route.prefix ? `prefix ${detail.route.prefix}` : 'any prefix', detail.route.sender_id ? `sender ${detail.route.sender_id}` : 'any sender', detail.route.tps_limit ? `${detail.route.tps_limit} TPS` : 'no TPS cap'].join(' · ')}</span></span>
                  <span><span className="text-muted">Chain</span> <span className="font-mono font-medium">{detail.route.vendors?.length ? [...detail.route.vendors].sort((a, b) => a.priority - b.priority).map((v) => `${v.vendor_name ?? vendorName(v.vendor_id)} (P${v.priority}${detail.route.strategy === 'percentage' ? ` ${v.weight}%` : ''})`).join('  →  ') : '— no vendors'}</span></span>
                  {Number(detail.route.policy_count ?? 0) > 0 && <span className="text-muted">{detail.route.policy_count} traffic policies</span>}
                </div>
                <div className="py-4"><RouteVendorRatesPanel routeId={detail.route.id} chain={detail.route.vendors ?? null} vendors={vendors} /></div>
                <div className="py-4"><RouteClientRatesPanel routeId={detail.route.id} routeCountryId={detail.route.country_id} onChanged={() => { openDetail(detail.route.id); load(); }} minVendorCost={(detail.route as unknown as { min_vendor_cost?: string | null }).min_vendor_cost ?? (detail.route as unknown as { internal_vendor_cost?: string | null }).internal_vendor_cost ?? null} /></div>
                <div className="py-4"><VendorDistributionEditor detail={detail} vendors={vendors} onSaved={() => { openDetail(detail.route.id); load(); }} /></div>
                <div className="py-4"><OtpTransformPanel route={detail.route} onChange={() => { openDetail(detail.route.id); load(); }} /></div>
                <div className="pt-4"><RouteDlrCuttingPanel routeId={detail.route.id} /></div>
              </div>

              {/* who it serves */}
              {scopeOf(detail.route) === 'global' ? (
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
                <MemberManager detail={detail} clients={clients} onChange={() => { openDetail(detail.route.id); load(); }} setDetail={setDetail} />
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

      <RouteWizard open={showWizard} onClose={() => setShowWizard(false)} onDone={() => load()} />

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
                <span className="input !w-auto text-muted">€ EUR</span>
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
