import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Money, Modal, Icon, EmptyState } from '../components';

interface PortalAccount {
  id: string; name: string; company_name: string | null; system_id: string;
  status: string; balance: string; credit_limit: string; currency: string;
  tps_limit: number; billing_mode: string;
  portal_email: string | null; portal_enabled: boolean;
  route_count: string; sender_count: string;
}

interface RouteOpt {
  id: string; name: string; strategy: string; status: string;
  client_id: string | null; country_name?: string | null;
}

interface Issued {
  portal_email: string;
  password: string;
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

export default function PortalAccounts(): JSX.Element {
  const [rows, setRows] = useState<PortalAccount[]>([]);
  const [routes, setRoutes] = useState<RouteOpt[]>([]);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState({
    name: '', company_name: '', system_id: '', portal_email: '',
    password: '', passwordMode: 'generate' as 'generate' | 'manual',
    showPw: false, currency: 'USD', credit_limit: '0', tps_limit: '50',
  });
  const [issued, setIssued] = useState<(Issued & { name: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  // per-row drawers
  const [credRow, setCredRow] = useState<PortalAccount | null>(null);
  const [routeRow, setRouteRow] = useState<PortalAccount | null>(null);
  const [balRow, setBalRow] = useState<PortalAccount | null>(null);

  const load = (): void => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    api<{ clients: PortalAccount[] }>(`/clients/portal-accounts${p.toString() ? `?${p}` : ''}`)
      .then((r) => setRows(r.clients))
      .catch(() => undefined);
    api<{ routes: RouteOpt[] }>('/routes').then((r) => setRoutes(r.routes)).catch(() => undefined);
  };
  useEffect(load, []);

  function openCreate(): void {
    setForm({
      name: '', company_name: '', system_id: '', portal_email: '',
      password: randomPassword(), passwordMode: 'generate',
      showPw: false, currency: 'USD', credit_limit: '0', tps_limit: '50',
    });
    setFormErr('');
    setShowCreate(true);
  }

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormErr('');
    try {
      const r = await api<{ client: PortalAccount; portal: Issued }>('/clients/portal-accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          company_name: form.company_name || undefined,
          system_id: form.system_id,
          portal_email: form.portal_email,
          ...(form.passwordMode === 'manual' ? { password: form.password } : {}),
          currency: form.currency,
          credit_limit: Number(form.credit_limit) || 0,
          tps_limit: Math.max(1, Number(form.tps_limit) || 50),
        }),
      });
      setIssued({ ...r.portal, name: r.client.name });
      setShowCreate(false);
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copyHandoff(): void {
    if (!issued) return;
    const msg =
      `Your SMS portal account is ready.\n` +
      `Sign in: ${location.origin}/portal/login\n` +
      `Email: ${issued.portal_email}\nPassword: ${issued.password}`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Portal accounts"
        sub="Client self-service logins · senders use the portal, never this console"
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={14} /> New portal account</button>}
      />

      <div className="card card-pad flex gap-2 items-center">
        <input className="input max-w-sm" placeholder="Search name, company, email, system ID…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn-ghost" onClick={load}>Search</button>
        <span className="ml-auto text-[11px] text-muted font-mono hidden md:block">
          {location.origin}/portal/login
        </span>
      </div>

      {/* ── Handoff card: shown ONCE after creation ── */}
      {issued && (
        <div className="card card-pad border-brand/40" style={{ boxShadow: '0 0 0 1px rgba(16,185,129,.35)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <Icon name="check" size={15} /> {issued.name} — portal account created, send them this login
            </div>
            <div className="flex gap-2">
              <button className="btn !py-1.5 !text-xs" onClick={copyHandoff}>
                {copied ? 'Copied ✓' : 'Copy login message'}
              </button>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setIssued(null)}>Dismiss</button>
            </div>
          </div>
          <p className="text-xs text-muted mt-1 mb-3">
            Password is shown <b>once</b> — it is stored hashed and can never be retrieved again (only reset).
          </p>
          <div className="rounded-lg bg-ink border border-line p-3.5 font-mono text-[13px] leading-relaxed space-y-1 max-w-xl">
            <div className="flex justify-between gap-2"><span className="text-muted">Sign in</span><span>{location.origin}/portal/login</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted">Email</span><span className="text-sky-300">{issued.portal_email}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted">Password</span><span className="text-amber-300 select-all">{issued.password}</span></div>
          </div>
        </div>
      )}

      {rows.length ? (
        <DataTable
          keyOf={(c) => c.id}
          rows={rows}
          columns={[
            {
              key: 'name', label: 'Account',
              render: (c) => (
                <div>
                  <Link className="font-semibold text-sky-300 hover:text-sky-200 hover:underline" to={`/clients/${c.id}`}>
                    {c.name}
                  </Link>
                  <div className="text-[11px] text-muted font-mono">{c.portal_email}</div>
                </div>
              ),
            },
            { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            {
              key: 'portal', label: 'Portal',
              render: (c) => (
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={c.portal_enabled ? 'enabled' : 'disabled'} />
                  <button className="text-[11px] text-brand hover:underline" onClick={() => setCredRow(c)}>
                    {c.portal_enabled ? 'reset pw' : 'enable'}
                  </button>
                </span>
              ),
            },
            { key: 'balance', label: 'Balance', right: true, render: (c) => <Money value={c.balance} currency={c.currency} /> },
            {
              key: 'routes', label: 'Routes',
              render: (c) => (
                <button className="text-[12px] font-mono text-sky-300 hover:underline" onClick={() => setRouteRow(c)}>
                  {c.route_count} route{Number(c.route_count) === 1 ? '' : 's'} ⚙
                </button>
              ),
            },
            {
              key: 'senders', label: 'Senders',
              render: (c) => <span className="tabular-nums text-xs">{c.sender_count} approved</span>,
            },
            {
              key: 'actions', label: 'Actions',
              render: (c) => (
                <span className="flex gap-1">
                  <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:text-white hover:border-brand/40"
                    onClick={() => setBalRow(c)}>
                    balance
                  </button>
                  <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:text-white hover:border-brand/40"
                    onClick={() => setCredRow(c)}>
                    login
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState icon="users" title="No portal accounts yet"
          sub="Create the first client login — they send SMS from the portal, you see everything here."
          action={<button className="btn" onClick={openCreate}><Icon name="plus" size={14} /> New portal account</button>} />
      )}

      {/* ── Create modal ── */}
      {showCreate && (
        <Modal title="New portal account" onClose={() => setShowCreate(false)}>
          <form onSubmit={create} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Display name *</label>
                <input className="input" placeholder="Acme Corp" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="label">Company</label>
                <input className="input" placeholder="Acme Ltd" value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">System ID (SMPP username) *</label>
                <input className="input font-mono" placeholder="client_001" value={form.system_id}
                  onChange={(e) => setForm({ ...form, system_id: e.target.value })} required />
              </div>
              <div>
                <label className="label">Portal email (login) *</label>
                <input className="input" type="email" placeholder="client@company.com" value={form.portal_email}
                  onChange={(e) => setForm({ ...form, portal_email: e.target.value })} required />
              </div>
            </div>
            <div>
              <label className="label">Portal password</label>
              <div className="flex gap-1.5 mb-2">
                {(['generate', 'manual'] as const).map((m) => (
                  <button key={m} type="button"
                    onClick={() => setForm({ ...form, passwordMode: m, password: m === 'generate' ? randomPassword() : form.password })}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${form.passwordMode === m
                      ? 'border-brand/50 text-emerald-300 bg-brand/10'
                      : 'border-line text-muted hover:text-white'}`}>
                    {m === 'generate' ? '⚄ Auto-generate' : '✎ Set manually'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <input
                  className="input font-mono !pr-20"
                  type={form.showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  readOnly={form.passwordMode === 'generate'}
                  minLength={8} required
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  <button type="button" className="text-[11px] text-muted hover:text-white px-1.5 py-1"
                    onClick={() => setForm({ ...form, showPw: !form.showPw })}>
                    {form.showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Currency</label>
                <div className="flex gap-1">
                  {(['USD', 'EUR', 'INR'] as const).map((cur) => (
                    <button key={cur} type="button" onClick={() => setForm({ ...form, currency: cur })}
                      className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition ${form.currency === cur
                        ? 'border-brand/50 bg-brand/10 text-emerald-300'
                        : 'border-line text-muted hover:text-white'}`}>
                      {cur}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Credit limit</label>
                <input className="input font-mono" value={form.credit_limit}
                  onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} inputMode="decimal" />
              </div>
              <div>
                <label className="label">TPS limit</label>
                <input className="input font-mono" value={form.tps_limit}
                  onChange={(e) => setForm({ ...form, tps_limit: e.target.value })} inputMode="numeric" />
              </div>
            </div>
            <p className="text-[11px] text-muted">
              Creates the client (active, postpay) + wallet + portal login in one step. Routes and balance come next.
            </p>
            <div className="flex gap-2">
              <button className="btn flex-1" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
              <button className="btn-ghost" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Login drawer ── */}
      {credRow && (
        <CredDrawer
          account={credRow}
          onClose={() => setCredRow(null)}
          onDone={load}
        />
      )}

      {/* ── Routes drawer ── */}
      {routeRow && (
        <RouteDrawer
          account={routeRow}
          routes={routes}
          onClose={() => setRouteRow(null)}
          onDone={load}
        />
      )}

      {/* ── Balance drawer ── */}
      {balRow && (
        <BalanceDrawer
          account={balRow}
          onClose={() => setBalRow(null)}
          onDone={load}
        />
      )}
    </div>
  );
}

// ── Login management: email, enable/disable, reset password ─────────────────
function CredDrawer({ account, onClose, onDone }: {
  account: PortalAccount; onClose: () => void; onDone: () => void;
}): JSX.Element {
  const [email, setEmail] = useState(account.portal_email ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [issuedPw, setIssuedPw] = useState('');
  const [copied, setCopied] = useState(false);

  async function saveEmail(): Promise<void> {
    setBusy(true);
    setErr('');
    try {
      await api(`/clients/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ portal_email: email || null }),
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(): Promise<void> {
    setBusy(true);
    setErr('');
    try {
      await api(`/clients/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ portal_enabled: !account.portal_enabled }),
      });
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPw(): Promise<void> {
    const ok = window.confirm(`Reset portal password for ${account.name}? Old password stops working immediately.`);
    if (!ok) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api<Issued>(`/clients/${account.id}/portal-password`, { method: 'POST' });
      setIssuedPw(r.password);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Portal login — ${account.name}`} onClose={onClose}>
      <div className="space-y-4">
        {err && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{err}</div>}
        <div>
          <label className="label">Portal email (login)</label>
          <div className="flex gap-2">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn-ghost shrink-0" disabled={busy} onClick={saveEmail}>Save</button>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-line bg-ink/50 px-3 py-2.5">
          <span className="text-sm">Portal access <StatusBadge status={account.portal_enabled ? 'enabled' : 'disabled'} /></span>
          <button className="btn-ghost !py-1.5 !text-xs" disabled={busy} onClick={toggle}>
            {account.portal_enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
        <div>
          <button className="btn w-full" disabled={busy || !account.portal_email} onClick={resetPw}>
            {busy ? 'Working…' : 'Reset password (show once)'}
          </button>
          {!account.portal_email && <p className="text-[11px] text-muted mt-1">Save an email first.</p>}
        </div>
        {issuedPw && (
          <div className="rounded-lg bg-ink border border-brand/40 p-3.5 font-mono text-[13px]">
            <div className="flex justify-between gap-2"><span className="text-muted">Password</span><span className="text-amber-300 select-all">{issuedPw}</span></div>
            <button className="btn flex-1 w-full mt-3 !py-1.5 !text-xs"
              onClick={() => {
                navigator.clipboard.writeText(
                  `Sign in at ${location.origin}/portal/login\nEmail: ${account.portal_email}\nPassword: ${issuedPw}`,
                ).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}>
              {copied ? 'Copied ✓' : 'Copy login message'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Route assignment: which routes serve this client ────────────────────────
function RouteDrawer({ account, routes, onClose, onDone }: {
  account: PortalAccount; routes: RouteOpt[]; onClose: () => void; onDone: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const mine = routes.filter((r) => r.client_id === account.id);
  const global = routes.filter((r) => !r.client_id);

  async function assign(routeId: string, toClient: boolean): Promise<void> {
    setBusy(true);
    try {
      await api(`/routes/${routeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ client_id: toClient ? account.id : null }),
      });
      onDone();
      // refresh route list in parent via reload
      const r = await api<{ routes: RouteOpt[] }>('/routes');
      routes.splice(0, routes.length, ...r.routes);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Routes — ${account.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Client-specific routes serve only this account. Global routes serve everyone (including this account).
          Assign a global route to make it exclusive, or unassign to return it to global.
        </p>
        <div>
          <div className="stat-label mb-1.5">Assigned to {account.name} ({mine.length})</div>
          {!mine.length && <div className="text-xs text-muted border border-dashed border-line rounded-lg px-3 py-2.5">None — only global routes apply.</div>}
          <div className="space-y-1.5">
            {mine.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm bg-brand/5 border border-brand/25 rounded-lg px-3 py-2">
                <span className="font-semibold">{r.name}</span>
                <span className="font-mono text-[11px] text-muted">{r.strategy}</span>
                <StatusBadge status={r.status} />
                <button className="ml-auto btn-ghost !py-1 !px-2 !text-xs" disabled={busy}
                  onClick={() => assign(r.id, false)}>
                  Make global
                </button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="stat-label mb-1.5">Global routes ({global.length})</div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {global.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm bg-ink/50 border border-line/60 rounded-lg px-3 py-2">
                <span className="font-medium">{r.name}</span>
                <span className="font-mono text-[11px] text-muted">{r.strategy}</span>
                {r.country_name && <span className="text-[11px] text-muted">{r.country_name}</span>}
                <button className="ml-auto btn-ghost !py-1 !px-2 !text-xs" disabled={busy}
                  onClick={() => assign(r.id, true)}>
                  Assign to {account.name}
                </button>
              </div>
            ))}
            {!global.length && <div className="text-xs text-muted">No global routes — create one under Routes & Failover.</div>}
          </div>
        </div>
        <p className="text-[11px] text-muted">
          Need a brand-new route for this client? <Link to="/routes" className="text-brand hover:underline">Create it under Routes & Failover</Link> with Client = {account.name}.
        </p>
      </div>
    </Modal>
  );
}

// ── Balance: top-up / deduct with mandatory remark ──────────────────────────
function BalanceDrawer({ account, onClose, onDone }: {
  account: PortalAccount; onClose: () => void; onDone: () => void;
}): JSX.Element {
  const [kind, setKind] = useState<'topup' | 'deduct'>('topup');
  const [amount, setAmount] = useState('100');
  const [remark, setRemark] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const n = Number(amount);
    if (!n || n <= 0) {
      setErr('Enter an amount greater than 0.');
      return;
    }
    if (remark.trim().length < 3) {
      setErr('Remark is required (min 3 characters) — it appears in the ledger.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api(`/billing/wallets/${account.id}/${kind}`, {
        method: 'POST',
        body: JSON.stringify({ amount: n, remark: remark.trim() }),
      });
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Balance — ${account.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Current</span>
          <Money value={account.balance} currency={account.currency} />
          <span className="text-muted text-xs ml-auto">credit <Money value={account.credit_limit} currency={account.currency} /></span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['topup', 'deduct'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${kind === k
                ? 'border-brand/50 bg-brand/10 text-emerald-300'
                : 'border-line text-muted hover:text-white'}`}>
              {k === 'topup' ? '+ Top up' : '− Deduct'}
            </button>
          ))}
        </div>
        <div>
          <label className="label">Amount ({account.currency})</label>
          <input className="input font-mono text-lg" value={amount}
            onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
        </div>
        <div>
          <label className="label">Remark * <span className="text-gray-600">(required — shown in ledger)</span></label>
          <input className="input" placeholder={kind === 'topup' ? 'e.g. Bank transfer ref HDFC-88231' : 'e.g. Correction — duplicate top-up'}
            value={remark} onChange={(e) => setRemark(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className={`btn flex-1 ${kind === 'deduct' ? '!bg-danger hover:!bg-red-500' : ''}`} type="submit" disabled={busy}>
            {busy ? 'Processing…' : kind === 'topup' ? 'Confirm top-up' : 'Confirm deduct'}
          </button>
          <button className="btn-ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
