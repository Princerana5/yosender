import { useEffect, useState } from 'react';
import { api, statusColor, fmtMoney } from '../api';

// Generic JSON-table page for: traffic, dlr, connections, policies, rates,
// reports, senders, countries, connectors, audit, users.
export function TablePage({ title, endpoint, columns, refreshMs }: {
  title: string;
  endpoint: string;
  columns: Array<{ key: string; label: string; render?: (row: Record<string, unknown>) => string }>;
  refreshMs?: number;
}): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const load = (): void => {
    api<{ [k: string]: Record<string, unknown>[] }>(endpoint)
      .then((r) => setRows(Object.values(r)[0] ?? []))
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="card p-0 overflow-x-auto">
        <table className="tbl w-full">
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="text-xs">
                    {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-4 text-sm text-gray-500">No data.</div>}
      </div>
    </div>
  );
}

const badge = (v: unknown): string => `<span>${String(v)}</span>`;

export function Connections(): JSX.Element {
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  useEffect(() => {
    api<{ connections: Array<Record<string, string>> }>('/system/health/smpp').then((r) => setRows(r.connections)).catch(() => undefined);
  }, []);
  async function act(id: string, action: string): Promise<void> {
    await api(`/system/connections/${id}/${action}`, { method: 'POST' });
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">SMPP connections</h1>
      <div className="card p-0 overflow-x-auto">
        <table className="tbl w-full">
          <thead><tr><th>Vendor</th><th>Status</th><th>Sent</th><th>Recv</th><th>DLRs</th><th>Last error</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.vendor_name}</td>
                <td><span className={`badge ${statusColor(r.status)}`}>{r.status}</span></td>
                <td>{r.messages_sent}</td>
                <td>{r.messages_received}</td>
                <td>{r.dlr_count}</td>
                <td className="text-red-400">{r.last_error ?? '—'}</td>
                <td className="space-x-1">
                  {['connect', 'disconnect', 'reconnect'].map((a) => (
                    <button key={a} className="btn-ghost !px-2 !py-0.5" onClick={() => act(r.id, a)}>{a}</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Reports(): JSX.Element {
  const [fin, setFin] = useState<Array<Record<string, string>>>([]);
  const [del, setDel] = useState<{ by_country: Array<Record<string, string>>; by_vendor: Array<Record<string, string>> }>({ by_country: [], by_vendor: [] });
  useEffect(() => {
    api<{ financial: [] }>('/reports/financial').then((r) => setFin(r.financial)).catch(() => undefined);
    api<typeof del>('/reports/delivery').then(setDel).catch(() => undefined);
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reports</h1>
      <div className="card">
        <div className="font-medium mb-2">Daily revenue / cost / profit</div>
        <table className="tbl w-full">
          <thead><tr><th>Day</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr></thead>
          <tbody>{fin.map((r, i) => (
            <tr key={i}><td>{String(r.day).slice(0, 10)}</td><td>{fmtMoney(r.revenue)}</td><td>{fmtMoney(r.cost)}</td><td className="text-brand">{fmtMoney(r.profit)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="card">
          <div className="font-medium mb-2">Delivery by country (7d)</div>
          {del.by_country.map((r, i) => (
            <div key={i} className="text-sm flex justify-between"><span>{String(r.country ?? r.iso_code)}</span><span>{r.delivered}/{r.total}</span></div>
          ))}
        </div>
        <div className="card">
          <div className="font-medium mb-2">Delivery by vendor (7d)</div>
          {del.by_vendor.map((r, i) => (
            <div key={i} className="text-sm flex justify-between"><span>{String(r.vendor)}</span><span>{r.delivered}/{r.total}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Traffic(): JSX.Element {
  const [d, setD] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = (): void => {
      api<{ realtime: Record<string, string> }>('/reports/dashboard').then((r) => setD(r.realtime ?? {})).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Live traffic</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(d).map(([k, v]) => (
          <div key={k} className="card"><div className="text-xs text-gray-400">{k}</div><div className="text-2xl font-bold text-brand">{v}</div></div>
        ))}
        {!Object.keys(d).length && <div className="text-gray-500">Waiting for traffic…</div>}
      </div>
    </div>
  );
}

void badge;
