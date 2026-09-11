import { NavLink, Outlet, useNavigate } from 'react-router-dom';

const NAV: Array<{ to: string; label: string; group: string }> = [
  { to: '/', label: 'Dashboard', group: 'Overview' },
  { to: '/traffic', label: 'Live Traffic', group: 'Overview' },
  { to: '/clients', label: 'Clients', group: 'Downstream' },
  { to: '/vendors', label: 'Vendors', group: 'Upstream' },
  { to: '/connections', label: 'SMPP Connections', group: 'Upstream' },
  { to: '/routes', label: 'Routes & Failover', group: 'Routing' },
  { to: '/policies', label: 'Traffic Policies', group: 'Routing' },
  { to: '/messages', label: 'Message Logs', group: 'Messages' },
  { to: '/dlr', label: 'DLR Logs', group: 'Messages' },
  { to: '/billing', label: 'Wallets & Ledger', group: 'Billing' },
  { to: '/rates', label: 'Rates', group: 'Billing' },
  { to: '/reports', label: 'Reports', group: 'Reports' },
  { to: '/senders', label: 'Sender IDs', group: 'System' },
  { to: '/countries', label: 'Countries', group: 'System' },
  { to: '/connectors', label: 'Channels', group: 'System' },
  { to: '/audit', label: 'Audit Logs', group: 'System' },
  { to: '/users', label: 'Users & Roles', group: 'System' },
];

export default function Layout(): JSX.Element {
  const nav = useNavigate();
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-line bg-panel p-4 flex flex-col">
        <div className="mb-6">
          <div className="text-xl font-bold text-brand">8xtelSMPP</div>
          <div className="text-xs text-gray-500">Messaging Gateway</div>
        </div>
        <nav className="flex-1 space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    `block px-3 py-1.5 rounded text-sm ${isActive ? 'bg-branddim text-white' : 'text-gray-300 hover:bg-line'}`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button
          className="btn-ghost mt-4"
          onClick={() => {
            localStorage.removeItem('xtel_token');
            nav('/login');
          }}
        >
          Logout
        </button>
      </aside>
      <main className="flex-1 p-6 max-w-[1400px]">
        <Outlet />
      </main>
    </div>
  );
}
