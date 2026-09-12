import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';
import { Icon } from './components';

interface NavItem {
  to: string;
  label: string;
  icon: 'grid' | 'pulse' | 'users' | 'server' | 'plug' | 'route' | 'mail' | 'check' | 'wallet' | 'chart' | 'shield' | 'globe' | 'tag' | 'layers' | 'sliders' | 'clock' | 'plus';
}

const GROUPS: Array<{ name: string; items: NavItem[] }> = [
  {
    name: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: 'grid' },
      { to: '/traffic', label: 'Live Traffic', icon: 'pulse' },
    ],
  },
  {
    name: 'Downstream',
    items: [
      { to: '/clients', label: 'Clients', icon: 'users' },
      { to: '/portal-accounts', label: 'Portal Accounts', icon: 'shield' },
    ],
  },
  {
    name: 'Upstream',
    items: [
      { to: '/vendors', label: 'Vendors', icon: 'server' },
      { to: '/connections', label: 'SMPP Connections', icon: 'plug' },
    ],
  },
  {
    name: 'Routing',
    items: [
      { to: '/routes', label: 'Routes & Failover', icon: 'route' },
      { to: '/policies', label: 'Traffic Policies', icon: 'sliders' },
    ],
  },
  {
    name: 'Messages',
    items: [
      { to: '/messages', label: 'Message Logs', icon: 'mail' },
      { to: '/send', label: 'Send Test SMS', icon: 'plus' },
      { to: '/dlr', label: 'DLR Logs', icon: 'check' },
    ],
  },
  {
    name: 'Billing',
    items: [
      { to: '/billing', label: 'Wallets & Ledger', icon: 'wallet' },
      { to: '/rates', label: 'Rates', icon: 'tag' },
    ],
  },
  { name: 'Reports', items: [{ to: '/reports', label: 'Reports', icon: 'chart' }] },
  {
    name: 'System',
    items: [
      { to: '/senders', label: 'Sender IDs', icon: 'shield' },
      { to: '/countries', label: 'Countries', icon: 'globe' },
      { to: '/connectors', label: 'Channels', icon: 'layers' },
      { to: '/audit', label: 'Audit Logs', icon: 'clock' },
      { to: '/users', label: 'Users & Roles', icon: 'users' },
    ],
  },
];

function useHealth(): { conns: number; vendors: number; ok: boolean } {
  const [h, setH] = useState({ conns: 0, vendors: 0, ok: true });
  useEffect(() => {
    let dead = false;
    const load = async (): Promise<void> => {
      try {
        const r = await api<{ connections: Array<{ status: string; vendor_name?: string }> }>('/system/health/smpp');
        if (dead) return;
        setH({
          conns: r.connections.filter((c) => c.status === 'connected').length,
          vendors: new Set(r.connections.map((c) => c.vendor_name ?? '?')).size,
          ok: true,
        });
      } catch {
        if (!dead) setH((p) => ({ ...p, ok: false }));
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);
  return h;
}

export default function Layout(): JSX.Element {
  const nav = useNavigate();
  const loc = useLocation();
  const health = useHealth();
  const [palette, setPalette] = useState(false);
  const [pq, setPq] = useState('');

  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const allItems = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.name })));
  const filtered = allItems.filter((i) => i.label.toLowerCase().includes(pq.toLowerCase()));

  const crumbs = (() => {
    for (const g of GROUPS)
      for (const i of g.items)
        if (i.to === loc.pathname || (i.to !== '/' && loc.pathname.startsWith(i.to + '/')))
          return [g.name, i.label];
    return ['Overview', 'Dashboard'];
  })();

  return (
    <div className="flex min-h-screen app-bg">
      {/* ── Sidebar ── */}
      <aside className="w-[248px] shrink-0 border-r border-line bg-panel/80 backdrop-blur flex flex-col sticky top-0 h-screen">
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-branddim flex items-center justify-center shadow-glow">
            <Icon name="bolt" size={18} className="text-white" />
          </div>
          <div>
            <div className="font-extrabold tracking-tight leading-none">
              8xtel<span className="text-brand">SMPP</span>
            </div>
            <div className="text-[10px] text-muted tracking-widest uppercase mt-0.5">Messaging Gateway</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
          {GROUPS.map((g) => (
            <div key={g.name}>
              <div className="px-3 mb-1 text-[10px] uppercase tracking-[0.12em] text-muted/80 font-semibold">
                {g.name}
              </div>
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) => `navlink mb-0.5 ${isActive ? 'navlink-active' : ''}`}
                >
                  <Icon name={n.icon} size={15} />
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* connection health */}
        <div className="mx-3 mb-2 rounded-lg border border-line bg-ink/60 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="relative flex w-2 h-2">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${health.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className={`relative inline-flex rounded-full w-2 h-2 ${health.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
            </span>
            <span className="font-semibold">{health.ok ? 'Systems nominal' : 'API unreachable'}</span>
          </div>
          <div className="text-[11px] text-muted mt-1 tabular-nums">
            {health.conns} SMPP binds · {health.vendors} vendors
          </div>
        </div>

        <div className="p-3 pt-1">
          <button
            className="navlink w-full text-left"
            onClick={() => {
              localStorage.removeItem('xtel_token');
              nav('/login');
            }}
          >
            <Icon name="x" size={15} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur px-6 py-3 flex items-center gap-3">
          <div className="text-[13px] text-muted">
            {crumbs[0]} <span className="mx-1 text-gray-600">/</span>{' '}
            <span className="text-gray-100 font-medium">{crumbs[1]}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="hidden md:flex items-center gap-2 text-xs text-muted border border-line rounded-lg px-3 py-1.5 hover:border-brand/50 hover:text-gray-200 transition bg-panel"
              onClick={() => setPalette(true)}
            >
              <Icon name="search" size={13} /> Jump to…
              <kbd className="font-mono text-[10px] bg-ink border border-line rounded px-1.5 py-0.5">Ctrl K</kbd>
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand to-sky-500 flex items-center justify-center text-xs font-bold text-white">
              A
            </div>
          </div>
        </header>

        <main className="flex-1 px-6 py-5 max-w-[1440px] w-full mx-auto space-y-5">
          <Outlet />
        </main>

        <footer className="px-6 py-3 text-[11px] text-muted/70 flex justify-between border-t border-line/50">
          <span>
            8xtelSMPP · Enterprise Messaging Gateway · <span className="font-mono">smpp.8xtelsmpp.com:2775</span>
          </span>
          <span className="tabular-nums">{new Date().toISOString().slice(0, 10)}</span>
        </footer>
      </div>

      {/* ── Command palette ── */}
      {palette && (
        <div className="modal-backdrop !items-start !pt-[15vh]" onClick={() => setPalette(false)}>
          <div className="card w-full max-w-lg overflow-hidden !p-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 border-b border-line">
              <Icon name="search" size={15} className="text-muted" />
              <input
                autoFocus
                className="bg-transparent outline-none text-sm py-3.5 w-full placeholder:text-gray-600"
                placeholder="Type a page name…"
                value={pq}
                onChange={(e) => setPq(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) {
                    nav(filtered[0].to);
                    setPalette(false);
                  }
                }}
              />
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {filtered.map((i) => (
                <button
                  key={i.to}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-panel2 hover:text-white text-left"
                  onClick={() => {
                    nav(i.to);
                    setPalette(false);
                  }}
                >
                  <Icon name={i.icon} size={15} className="text-muted" />
                  {i.label}
                  <span className="ml-auto text-[11px] text-muted">{i.group}</span>
                </button>
              ))}
              {!filtered.length && <div className="p-4 text-sm text-muted text-center">No matches.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
