import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { PageHeader, StatCard, DataTable, StatusBadge, Money, Icon } from './components';

// ── Portal API client (separate token from the admin console) ────────────────
const BASE = import.meta.env.VITE_API_URL ?? '';

/** API base for raw fetch() calls (file upload / CSV export) that bypass portalApi. */
export const API_BASE = BASE;

export function portalToken(): string | null {
  return localStorage.getItem('xtel_portal_token');
}

export async function portalApi<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(portalToken() ? { authorization: `Bearer ${portalToken()}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('xtel_portal_token');
    if (location.pathname.startsWith('/portal') && location.pathname !== '/portal/login') {
      location.href = '/portal/login';
    }
    throw new Error('session expired — please sign in again');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function portalLogout(nav: (p: string) => void): void {
  localStorage.removeItem('xtel_portal_token');
  nav('/portal/login');
}

// ── Portal login ─────────────────────────────────────────────────────────────
export function PortalLogin(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const body = await portalApi<{ token: string }>('/portal/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('xtel_portal_token', body.token);
      nav('/portal');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen app-bg flex items-center justify-center p-4">
      <div className="w-full max-w-[880px] grid md:grid-cols-2 card overflow-hidden !p-0">
        <div className="hidden md:flex flex-col justify-between p-8 bg-gradient-to-br from-branddim/40 via-panel to-panel relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'radial-gradient(rgba(16,185,129,.25) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
            }}
          />
          <div className="relative flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-branddim flex items-center justify-center shadow-glow">
              <Icon name="bolt" size={20} className="text-white" />
            </div>
            <div className="font-extrabold text-lg tracking-tight">
              8xtel<span className="text-brand">SMPP</span>
            </div>
          </div>
          <div className="relative">
            <div className="text-2xl font-bold leading-snug tracking-tight">
              Your SMS account.
              <br />
              Send in seconds.
            </div>
            <p className="text-sm text-muted mt-3 leading-relaxed">
              Send SMS, track delivery in real time, check your balance and request top-ups —
              all from one place.
            </p>
          </div>
          <div className="relative text-[11px] text-muted">Need help? Contact your account manager.</div>
        </div>
        <form onSubmit={submit} className="p-8 space-y-5">
          <div>
            <div className="text-xl font-bold tracking-tight">Client sign in</div>
            <div className="text-sm text-muted mt-1">Use the portal email + password from your provider</div>
          </div>
          {err && (
            <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5">
              {err}
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input className="input" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn w-full !py-2.5" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Portal shell ─────────────────────────────────────────────────────────────
export function PortalLayout(): JSX.Element {
  const nav = useNavigate();
  const [name, setName] = useState('');

  useEffect(() => {
    portalApi<{ client: { name: string } }>('/portal/me')
      .then((r) => setName(r.client.name))
      .catch(() => undefined);
  }, []);

  const links = [
    { to: '/portal', label: 'Overview', end: true },
    { to: '/portal/send', label: 'Send SMS', end: false },
    { to: '/portal/coverage', label: 'Coverage', end: false },
    { to: '/portal/reports', label: 'Reports', end: false },
    { to: '/portal/wallet', label: 'Wallet', end: false },
  ];

  return (
    <div className="min-h-screen app-bg flex flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur px-6 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-branddim flex items-center justify-center">
            <Icon name="bolt" size={15} className="text-white" />
          </div>
          <div className="font-extrabold tracking-tight">
            8xtel<span className="text-brand">SMPP</span>
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-muted">Client portal</span>
          </div>
        </div>
        <nav className="flex gap-1 ml-6">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => `navlink ${isActive ? 'navlink-active' : ''}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {name && <span className="text-xs text-muted">{name}</span>}
          <button className="navlink" onClick={() => portalLogout(nav)}>
            <Icon name="x" size={14} /> Logout
          </button>
        </div>
      </header>
      <main className="flex-1 px-6 py-5 max-w-[1100px] w-full mx-auto space-y-5">
        <Outlet />
      </main>
    </div>
  );
}

// ── Portal: overview ─────────────────────────────────────────────────────────
interface PortalMe {
  client: {
    id: string; name: string; status: string; balance: string;
    currency: string; tps_limit: number; billing_mode: string;
  };
  traffic: { today: string; month: string; delivered: string; failed: string };
  recent: Array<{
    id: string; source: string; destination: string; status: string;
    created_at: string; client_price: string | null; country_name: string | null;
  }>;
}

export function PortalOverview(): JSX.Element {
  const [d, setD] = useState<PortalMe | null>(null);

  useEffect(() => {
    portalApi<PortalMe>('/portal/me').then(setD).catch(() => undefined);
  }, []);

  if (!d) {
    return <div className="card card-pad animate-pulse"><div className="h-6 w-48 bg-line rounded" /></div>;
  }
  const t = d.traffic;
  return (
    <div className="space-y-5">
      <PageHeader title={`Hello, ${d.client.name}`} sub="Your account at a glance" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={`Balance (${d.client.currency})`} value={Number(d.client.balance).toFixed(2)}
          tone={Number(d.client.balance) <= 0 ? 'warn' : 'brand'} />
        <StatCard label="Sent today" value={Number(t.today).toLocaleString()} />
        <StatCard label="Sent this month" value={Number(t.month).toLocaleString()} />
        <StatCard label="Delivered (all time)" value={Number(t.delivered).toLocaleString()} tone="brand" />
      </div>
      <div>
        <div className="card-title mb-2 px-1">Recent messages</div>
        <DataTable
          keyOf={(m) => m.id}
          rows={d.recent}
          empty="Nothing sent yet."
          columns={[
            {
              key: 'created_at', label: 'Time',
              render: (m) => <span className="text-xs text-muted whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</span>,
            },
            {
              key: 'route', label: 'From → To', mono: true,
              render: (m) => <span>{m.source} <span className="text-muted">→</span> {m.destination}</span>,
            },
            { key: 'status', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
            { key: 'client_price', label: 'Cost', right: true, render: (m) => <Money value={m.client_price} currency={d.client.currency} /> },
          ]}
        />
      </div>
    </div>
  );
}
