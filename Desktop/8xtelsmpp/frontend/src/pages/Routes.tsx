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
    <div className={`rounded-lg border px-3.5 py-3 text-[13px] space-y-2.5 ${ready ? 'border-brand/40 bg-brand/5' : 'border-line bg-ink/50'}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">⚡ OTP Mode {ready && <span className="text-emerald-300">· working ✓</span>}</span>
        {ready && (
          <button
            className="ml-auto rounded-full border border-brand/50 bg-brand/10 text-emerald-300 px-3 py-1 text-xs font-bold"
            disabled={busy}
            onClick={() => void patch({ otp_transform_enabled: false })}
          >
            ● ON — turn off
          </button>
        )}
      </div>

      {!ready ? (
        <div className="space-y-2.5">
          <div className="text-xs text-muted">
            Client sends <b className="text-gray-300">any Sender ID + any OTP text</b> → we rewrite it to your
            approved template + Sender ID → HSP vendor. Pick a template, flip the switch, done.
          </div>
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

// ── Member manager: add/remove clients on a member route ───────────────────
function MemberManager({ detail, clients, onChange, setDetail }: {
  detail: RouteDetail; clients: Opt[]; onChange: () => void; setDetail: (d: RouteDetail | null) => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const needle = search.trim().toLowerCase();
  const available = (detail.available ?? []).filter((c) =>
    !needle || c.name.toLowerCase().includes(needle) || (c.system_id ?? '').toLowerCase().includes(needle),
  );

  async function add(clientId: string): Promise<void> {
    setBusy(true);
    try {
      await api(`/routes/${detail.route.id}/members`, { method: 'POST', body: JSON.stringify({ client_id: clientId }) });
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: { id: string; name: string }): Promise<void> {
    const remaining = detail.served_clients.length - 1;
    const warn = remaining === 0
      ? `\n\n⚠ This is the LAST member — removing makes the route GLOBAL (serves everyone).`
      : '';
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
      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">
        Members ({detail.served_clients.length}) · only these clients use this route
      </div>
      <div className="space-y-1 max-h-36 overflow-y-auto">
        {detail.served_clients.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-sm bg-brand/5 border border-brand/25 rounded-lg px-3 py-1.5">
            <Link className="font-semibold text-sky-300 hover:underline" to={`/clients/${c.id}`} onClick={() => setDetail(null)}>{c.name}</Link>
            <span className="text-[11px] text-muted font-mono">{c.system_id}</span>
            <button className="btn-ghost !py-0.5 !px-2 !text-[11px] ml-auto" disabled={busy}
              title={`Remove ${c.name} from this route`}
              onClick={() => remove(c)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2.5">
        <input className="input !py-1.5 !text-xs" placeholder="+ Add client — search name or system ID…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {search.trim() && (
          <div className="space-y-1 mt-1.5 max-h-32 overflow-y-auto">
            {available.slice(0, 8).map((c) => (
              <button key={c.id} disabled={busy}
                className="w-full flex items-center gap-2 text-sm border border-line hover:border-brand/40 rounded-lg px-3 py-1.5 text-left transition"
                onClick={() => { setSearch(''); add(c.id); }}>
                <span className="font-medium">{c.name}</span>
                <span className="text-[11px] text-muted font-mono">{c.system_id}</span>
                <span className="ml-auto text-emerald-300 text-xs font-bold">+ Add</span>
              </button>
            ))}
            {!available.length && <div className="text-xs text-muted px-1 py-1">No matching clients (all active clients already members).</div>}
          </div>
        )}
        {!search.trim() && (detail.available ?? []).length > 0 && (
          <div className="text-[11px] text-muted mt-1">{detail.available.length} other client{(detail.available.length === 1) ? '' : 's'} can be added — search above.</div>
        )}
      </div>
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
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const CURS = ['EUR'] as const;
  const [form, setForm] = useState({
    name: '', prefix: '', sender_id: '', strategy: 'priority',
    client_ids: [] as string[], country_id: '', price: '', currency: 'EUR', margin: '', tps: '',
  });
  const [clientSearch, setClientSearch] = useState('');
  const [editing, setEditing] = useState<Route | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCurrency, setEditCurrency] = useState('EUR');
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
    setChain((prev) => {
      if (prev.some((v) => v.vendor_id === id)) return prev.filter((v) => v.vendor_id !== id);
      return [...prev, { vendor_id: id, priority: prev.length + 1, weight: 100 }];
    });
  }

  function toggleFormClient(id: string): void {
    setForm((f) => ({
      ...f,
      client_ids: f.client_ids.includes(id) ? f.client_ids.filter((c) => c !== id) : [...f.client_ids, id],
    }));
  }

  function openModal(): void {
    setForm({ name: '', prefix: '', sender_id: '', strategy: 'priority', client_ids: [], country_id: '', price: '', currency: 'EUR', margin: '', tps: '' });
    setClientSearch('');
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
          client_ids: form.client_ids,
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
                  <button className="font-semibold text-sky-300 hover:text-sky-200 hover:underline text-left"
                    onClick={() => openDetail(r.id)} title="Open route detail">
                    {r.name}
                  </button>
                  <div className="flex items-center gap-1.5 mt-1">
                    <ScopeBadge route={r} clients={clients} />
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
                    onClick={() => { setEditing(r); setEditPrice(String(r.price_per_segment)); setEditCurrency(r.price_currency ?? 'EUR'); setEditMargin(r.min_margin_pct ?? ''); }}>
                    {Number(r.price_per_segment).toFixed(4)} <span className="text-[10px] text-muted">{r.price_currency ?? 'EUR'}</span>
                  </button>
                  {r.below_margin && (
                    <span className="block text-[10px] font-bold text-red-300" title={`Floor ${r.margin_floor?.toFixed(4)} = cost ${Number(r.min_vendor_cost).toFixed(4)} + ${Number(r.min_margin_pct).toFixed(1)}%`}>
                      ⚠ below margin (floor {r.margin_floor?.toFixed(4)})
                    </span>
                  )}
                </span>
              ) : (
                <button className="text-xs text-muted hover:text-white" title="Set route price"
                  onClick={() => { setEditing(r); setEditPrice(''); setEditCurrency('EUR'); setEditMargin(r.min_margin_pct ?? ''); }}>
                  + set
                </button>
              ),
            },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'otp', label: 'OTP',
              render: (r) => {
                const on = !!(r as { otp_transform_enabled?: boolean }).otp_transform_enabled;
                const tpl = (r as { otp_default_template_name?: string; otp_default_template_id?: string | null });
                return (
                  <button
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full border transition ${on
                      ? 'border-brand/50 bg-brand/10 text-emerald-300'
                      : 'border-line text-muted hover:text-white'}`}
                    title={on
                      ? `OTP transform ON${tpl.otp_default_template_name ? ` → ${tpl.otp_default_template_name}` : ' (no template!)'} — click to open route settings`
                      : 'OTP transform OFF — click to set up'}
                    onClick={() => openDetail(r.id)}
                  >
                    {on ? '⚡ ON' : 'OFF'}
                  </button>
                );
              },
            },
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
                    title={scopeOf(r) === 'global' ? `Delete GLOBAL route "${r.name}" (serves all clients)` : `Delete route "${r.name}" (${memberCount(r)} client${memberCount(r) === 1 ? '' : 's'})`}
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
                <OtpTransformPanel route={detail.route} onChange={() => { openDetail(detail.route.id); load(); }} />
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

      {show && (
        <Modal title="New route" onClose={() => setShow(false)} wide>
          <form onSubmit={create} className="space-y-3">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            {/* name */}
            <div>
              <label className="label">Route name</label>
              <input className="input" placeholder="India Premium — all clients" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </div>
            {/* clients multi-select */}
            <div>
              <label className="label">
                Select clients{' '}
                <span className="text-gray-600 font-normal">
                  ({form.client_ids.length === 0 ? 'none = 🌍 global, serves everyone' : `${form.client_ids.length} selected`})
                </span>
              </label>
              {form.client_ids.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.client_ids.map((id) => {
                    const c = clients.find((x) => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand/10 text-emerald-300 border border-brand/30 rounded-full pl-2.5 pr-1.5 py-1">
                        {c?.name ?? id.slice(0, 8)}
                        <button type="button" onClick={() => toggleFormClient(id)}
                          className="w-4 h-4 rounded-full hover:bg-brand/25 flex items-center justify-center text-[10px]" title="Remove">
                          ✕
                        </button>
                      </span>
                    );
                  })}
                  <button type="button" onClick={() => setForm({ ...form, client_ids: [] })}
                    className="text-[11px] text-muted hover:text-red-300 underline underline-offset-2">
                    Clear all → global
                  </button>
                </div>
              )}
              <input className="input !py-1.5 !text-xs mb-1.5" placeholder="Search clients to add…"
                value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
              <div className="space-y-1 max-h-32 overflow-y-auto border border-line/60 rounded-lg p-1.5 bg-ink/40">
                {clients
                  .filter((c) => {
                    const n = clientSearch.trim().toLowerCase();
                    return !n || c.name.toLowerCase().includes(n) || (c.system_id ?? '').toLowerCase().includes(n);
                  })
                  .slice(0, 30)
                  .map((c) => {
                    const picked = form.client_ids.includes(c.id);
                    return (
                      <label key={c.id}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition text-sm ${picked ? 'border-brand/50 bg-brand/5' : 'border-transparent hover:border-line hover:bg-panel2/50'}`}>
                        <input type="checkbox" checked={picked} onChange={() => toggleFormClient(c.id)} className="accent-emerald-500" />
                        <span className="font-medium truncate">{c.name}</span>
                        <span className="text-[11px] text-muted font-mono ml-auto shrink-0">{c.system_id}</span>
                      </label>
                    );
                  })}
                {!clients.length && <div className="text-sm text-muted px-1 py-2">No clients yet — create one under Clients first.</div>}
              </div>
              <p className="text-[11px] text-muted mt-1">
                {form.client_ids.length === 0
                  ? '🌍 Global: every client falls back to it. Deleting later needs typed confirmation.'
                  : form.client_ids.length === 1
                    ? '🎯 1 client: only they use it. Safe to delete anytime.'
                    : `👥 ${form.client_ids.length} clients: only they use it. Manage membership later from route detail.`}
              </p>
            </div>
            {/* match: country + prefix + sender + tps on one row */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="col-span-2">
                <label className="label">Country</label>
                <select className="input" value={form.country_id}
                  onChange={(e) => setForm({ ...form, country_id: e.target.value })}>
                  <option value="">All countries</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Prefix</label>
                <input className="input font-mono" placeholder="91 · any" value={form.prefix}
                  onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
              </div>
              <div>
                <label className="label">Sender · TPS</label>
                <div className="flex gap-1.5">
                  <input className="input font-mono" placeholder="sender" value={form.sender_id}
                    onChange={(e) => setForm({ ...form, sender_id: e.target.value })} />
                  <input className="input font-mono !w-[70px] shrink-0" placeholder="tps" value={form.tps}
                    onChange={(e) => setForm({ ...form, tps: e.target.value })} inputMode="numeric" title="TPS cap (blank = none)" />
                </div>
              </div>
            </div>
            {/* price + margin + strategy on one row */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="col-span-2">
                <label className="label">Price / seg <span className="text-gray-600">(blank = rate card)</span></label>
                <div className="flex gap-1.5">
                  <input className="input font-mono flex-1" placeholder="0.0045" value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
                  <span className="input !w-auto text-muted">€ EUR</span>
                </div>
              </div>
              <div>
                <label className="label">Margin %</label>
                <input className="input font-mono" placeholder="15 · none" value={form.margin}
                  onChange={(e) => setForm({ ...form, margin: e.target.value })} inputMode="decimal" title="Warn-only margin guard" />
              </div>
              <div>
                <label className="label">Strategy</label>
                <select className="input font-mono !text-[13px]" value={form.strategy}
                  onChange={(e) => setForm({ ...form, strategy: e.target.value })}
                  title={STRATEGY_HINT[form.strategy]}>
                  {STRATEGIES.map(([v, desc]) => (
                    <option key={v} value={v} title={desc}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-muted -mt-1">
              {STRATEGY_HINT[form.strategy]}
            </p>
            {/* vendors: compact rows */}
            <div>
              <label className="label">Vendors <span className="text-gray-600">(click to add · first = priority 1)</span></label>
              <div className="space-y-1 max-h-36 overflow-y-auto border border-line/60 rounded-lg p-1.5 bg-ink/40">
                {vendors.map((v) => {
                  const picked = chain.find((c) => c.vendor_id === v.id);
                  return (
                    <label key={v.id}
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition text-sm ${picked ? 'border-brand/50 bg-brand/5' : 'border-transparent hover:border-line hover:bg-panel2/50'}`}>
                      <input type="checkbox" checked={!!picked} onChange={() => toggleVendor(v.id)} className="accent-emerald-500" />
                      <span className="font-medium truncate">{v.name}</span>
                      {picked && (
                        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted shrink-0" onClick={(e) => e.stopPropagation()}>
                          P<input type="number" min={1} value={picked.priority}
                            onChange={(e) => setChain(chain.map((c) => c.vendor_id === v.id ? { ...c, priority: Number(e.target.value) } : c))}
                            className="input font-mono !w-12 !py-0.5 !px-1.5 !text-[11px]" />
                          {form.strategy === 'percentage' && (
                            <span className="flex items-center gap-0.5">%<input type="number" min={1} max={100} value={picked.weight}
                              onChange={(e) => setChain(chain.map((c) => c.vendor_id === v.id ? { ...c, weight: Number(e.target.value) } : c))}
                              className="input font-mono !w-12 !py-0.5 !px-1.5 !text-[11px]" /></span>
                          )}
                        </span>
                      )}
                    </label>
                  );
                })}
                {!vendors.length && <div className="text-sm text-muted px-1 py-2">No vendors yet — create one under Vendors first.</div>}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
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
