import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, StatCard, Bars, Icon, Money, Modal } from '../components';

// Generic JSON-table page for: policies, rates, senders, countries,
// connectors, audit, users.
export function TablePage({ title, sub, endpoint, columns, refreshMs }: {
  title: string;
  sub?: string;
  endpoint: string;
  columns: Array<{ key: string; label: string; render?: (row: Record<string, unknown>) => React.ReactNode; mono?: boolean; right?: boolean }>;
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
    <div className="space-y-5">
      <PageHeader title={title} sub={sub ?? `${rows.length} records`} />
      <DataTable keyOf={(_, i) => String(i)} rows={rows} columns={columns} />
    </div>
  );
}

// Sender IDs page = TablePage + client request queue (approve/reject)
interface SenderReq {
  id: string; client_id: string; client_name: string; sender: string;
  country_name: string | null; status: string; created_at: string;
}

export function SendersPage({ title, sub, endpoint, columns }: {
  title: string;
  sub?: string;
  endpoint: string;
  columns: Array<{ key: string; label: string; render?: (row: Record<string, unknown>) => React.ReactNode; mono?: boolean; right?: boolean }>;
}): JSX.Element {
  const [reqs, setReqs] = useState<SenderReq[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState('');

  const loadReqs = (): void => {
    api<{ requests: SenderReq[] }>(`/system/sender-requests${showAll ? '' : '?status=pending'}`)
      .then((r) => setReqs(r.requests))
      .catch(() => undefined);
  };
  useEffect(loadReqs, [showAll]);

  async function decide(r: SenderReq, action: 'approve' | 'reject'): Promise<void> {
    setBusy(`${r.id}:${action}`);
    try {
      await api(`/system/sender-requests/${r.id}/review`, { method: 'POST', body: JSON.stringify({ action }) });
      loadReqs();
    } finally {
      setBusy('');
    }
  }

  const pending = reqs.filter((r) => r.status === 'pending');
  return (
    <div className="space-y-5">
      <TablePage title={title} sub={sub} endpoint={endpoint} columns={columns} />
      <div className="card card-pad">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="card-title">
              Sender requests
              {!!pending.length && (
                <span className="ml-2 badge bg-warn/15 text-amber-300 border border-warn/25">{pending.length} pending</span>
              )}
            </div>
            <div className="card-sub">Client asks → approve (activates sender) or reject</div>
          </div>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Pending only' : 'Show all'}
          </button>
        </div>
        {!reqs.length ? (
          <div className="text-sm text-muted py-4 text-center">No {showAll ? '' : 'pending '}requests.</div>
        ) : (
          <div className="mt-3 space-y-1.5">
            {reqs.slice(0, showAll ? 20 : 10).map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 text-sm bg-ink/50 border border-line/60 rounded-lg px-3 py-2">
                <span className="font-semibold">{r.client_name}</span>
                <span className="font-mono">{r.sender}</span>
                {r.country_name && <span className="text-xs text-muted">{r.country_name}</span>}
                <StatusBadge status={r.status === 'approved' ? 'delivered' : r.status === 'rejected' ? 'failed' : 'submitted'} />
                <span className="text-[11px] text-muted ml-auto">{new Date(r.created_at).toLocaleString()}</span>
                {r.status === 'pending' && (
                  <span className="flex gap-1 shrink-0">
                    <button className="btn !py-1 !px-2.5 !text-xs" disabled={!!busy}
                      onClick={() => decide(r, 'approve')}>
                      {busy === `${r.id}:approve` ? '…' : 'Approve'}
                    </button>
                    <button className="btn-ghost !py-1 !px-2.5 !text-xs hover:!border-danger/50 hover:!text-red-300"
                      disabled={!!busy} onClick={() => decide(r, 'reject')}>
                      {busy === `${r.id}:reject` ? '…' : 'Reject'}
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SmppConn extends Record<string, string> {
  id: string;
  vendor_name: string;
  host: string;
  port: string;
  system_id: string;
  bind_type: string;
  conn_index: string;
  status: string;
  status_line: string;
  last_error: string;
  last_log_kind: string;
  last_log_at: string;
  connected_since: string;
  reconnect_count: string;
}

interface ConnLog {
  id: number; kind: string; ip: string | null; port: number | null;
  system_id: string | null; result: string | null; reason: string | null;
  created_at: string;
}

export function Connections(): JSX.Element {
  const [rows, setRows] = useState<SmppConn[]>([]);
  const [acting, setActing] = useState('');
  const [copied, setCopied] = useState('');
  const [logRow, setLogRow] = useState<SmppConn | null>(null);
  const [logs, setLogs] = useState<ConnLog[]>([]);
  const [logsBusy, setLogsBusy] = useState(false);
  const load = (): void => {
    api<{ connections: SmppConn[] }>('/system/health/smpp')
      .then((r) => setRows(r.connections))
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  async function act(id: string, action: string): Promise<void> {
    setActing(`${id}:${action}`);
    try {
      await api(`/system/connections/${id}/${action}`, { method: 'POST' });
      setTimeout(load, 1500);
    } finally {
      setActing('');
    }
  }

  function copyStatus(r: SmppConn): void {
    const msg =
      `${r.status_line}\n` +
      `Vendor: ${r.vendor_name} (${r.host}:${r.port} · ${r.system_id} · bind ${r.bind_type} #${r.conn_index})\n` +
      `Connected since: ${r.connected_since || '—'} · reconnects: ${r.reconnect_count || '0'}\n` +
      `Last event: ${r.last_log_kind || '—'}${r.last_log_at ? ` at ${new Date(r.last_log_at).toLocaleString()}` : ''}`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(r.id);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => undefined);
  }

  function copyLogs(): void {
    if (!logRow || !logs.length) return;
    const msg =
      `${logRow.status_line}\n` +
      logs.map((l) =>
        `[${new Date(l.created_at).toLocaleString()}] ${l.kind}${l.result ? ` → ${l.result}` : ''}${l.reason ? ` — ${l.reason}` : ''}`,
      ).join('\n');
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(`logs:${logRow.id}`);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => undefined);
  }

  async function openLogs(r: SmppConn): Promise<void> {
    setLogRow(r);
    setLogs([]);
    setLogsBusy(true);
    try {
      const res = await api<{ logs: ConnLog[] }>(`/system/connections/${r.id}/logs?limit=100`);
      setLogs(res.logs);
    } catch {
      setLogs([]);
    } finally {
      setLogsBusy(false);
    }
  }

  const connected = rows.filter((r) => r.status === 'connected').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="SMPP connections"
        sub={`${connected}/${rows.length} binds up · control propagates to vendor workers via Redis`}
        actions={<button className="btn-ghost" onClick={load}><Icon name="refresh" size={14} /> Refresh</button>}
      />
      <DataTable
        keyOf={(r, i) => r.id ?? String(i)}
        rows={rows}
        empty="No vendor connections configured yet."
        columns={[
          {
            key: 'vendor_name', label: 'Vendor / bind',
            render: (r) => (
              <div>
                <span className="font-semibold">{r.vendor_name}</span>
                <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-panel2 text-muted border border-line align-middle font-mono">
                  {(r.bind_type ?? 'transceiver').toUpperCase()} #{r.conn_index ?? 0}
                </span>
                <div className="text-[11px] text-muted font-mono">{r.host}:{r.port} · {r.system_id}</div>
              </div>
            ),
          },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'reason', label: 'Reason',
            render: (r) => (r.last_error || r.status_line)
              ? (
                <span className="block max-w-[260px]">
                  <span className="text-xs font-mono truncate block" title={r.last_error || r.status_line}>
                    {r.last_error || r.status_line}
                  </span>
                  {r.last_log_at && (
                    <span className="text-[10px] text-muted">
                      {r.last_log_kind ?? 'event'} · {new Date(r.last_log_at).toLocaleString()}
                    </span>
                  )}
                </span>
              )
              : <span className="text-muted">—</span>,
          },
          { key: 'messages_sent', label: 'Sent', right: true, render: (r) => <span className="tabular-nums">{Number(r.messages_sent).toLocaleString()}</span> },
          { key: 'messages_received', label: 'Recv', right: true, render: (r) => <span className="tabular-nums">{Number(r.messages_received).toLocaleString()}</span> },
          { key: 'dlr_count', label: 'DLRs', right: true, render: (r) => <span className="tabular-nums">{Number(r.dlr_count).toLocaleString()}</span> },
          {
            key: 'actions', label: 'Actions',
            render: (r) => (
              <span className="flex gap-1 flex-wrap">
                {['connect', 'reconnect', 'disconnect'].map((a) => (
                  <button key={a} disabled={!!acting}
                    className={`text-[11px] font-semibold px-2 py-1 rounded-md border transition ${a === 'disconnect'
                      ? 'border-danger/30 text-red-300/80 hover:bg-danger/10'
                      : 'border-line text-muted hover:text-white hover:border-brand/40'}`}
                    onClick={() => act(r.id, a)}>
                    {acting === `${r.id}:${a}` ? '…' : a}
                  </button>
                ))}
                <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:text-white hover:border-brand/40"
                  onClick={() => openLogs(r)}>
                  logs
                </button>
                <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:text-white hover:border-brand/40"
                  onClick={() => copyStatus(r)}>
                  {copied === r.id ? 'copied ✓' : 'copy'}
                </button>
              </span>
            ),
          },
        ]}
      />

      {logRow && (
        <Modal title={`Logs — ${logRow.vendor_name} · ${String(logRow.bind_type).toUpperCase()} #${logRow.conn_index}`} onClose={() => setLogRow(null)} wide>
          <div className="rounded-lg border border-line bg-ink/60 px-3 py-2.5 font-mono text-[12px] mb-3">
            <span className="text-emerald-300">{logRow.status_line}</span>
          </div>
          {logsBusy ? (
            <div className="text-sm text-muted py-6 text-center animate-pulse">Loading logs…</div>
          ) : logs.length ? (
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {logs.map((l) => (
                <div key={l.id} className="rounded-lg border border-line/60 bg-ink/50 px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={l.kind === 'error' ? 'failed' : l.kind === 'bind' ? 'submitted' : 'unknown'} />
                    <span className="font-mono text-gray-300">{l.kind}{l.result ? ` → ${l.result}` : ''}</span>
                    <span className="text-[11px] text-muted ml-auto whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </span>
                  </div>
                  {l.reason && <div className="font-mono text-[12px] text-amber-200/90 mt-1 break-words">{l.reason}</div>}
                  {(l.ip || l.system_id) && (
                    <div className="text-[11px] text-muted font-mono mt-0.5">
                      {[l.system_id, l.ip, l.port].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted py-6 text-center">No log entries for this vendor yet.</div>
          )}
          <div className="flex gap-2 mt-4">
            <button className="btn flex-1 !py-1.5 !text-xs" disabled={!logs.length} onClick={copyLogs}>
              {copied === `logs:${logRow.id}` ? 'Copied ✓' : 'Copy status + logs to share'}
            </button>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setLogRow(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Reports(): JSX.Element {
  const [fin, setFin] = useState<Array<Record<string, string>>>([]);
  const [del, setDel] = useState<{ by_country: Array<Record<string, string>>; by_vendor: Array<Record<string, string>> }>({
    by_country: [], by_vendor: [],
  });
  useEffect(() => {
    api<{ financial: [] }>('/reports/financial').then((r) => setFin(r.financial)).catch(() => undefined);
    api<typeof del>('/reports/delivery').then(setDel).catch(() => undefined);
  }, []);

  const totRev = fin.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
  const totCost = fin.reduce((s, r) => s + Number(r.cost ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" sub="Revenue, cost and delivery · last 30 days" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Revenue · 30d" value={`$${totRev.toFixed(2)}`} tone="brand" />
        <StatCard label="Cost · 30d" value={`$${totCost.toFixed(2)}`} />
        <StatCard label="Profit · 30d" value={`$${(totRev - totCost).toFixed(2)}`} tone="brand" />
      </div>
      <div className="card card-pad">
        <div className="card-title">Daily P&L</div>
        <div className="card-sub">Revenue vs cost per day</div>
        <div className="mt-4">
          <Bars
            data={fin.map((r) => ({
              label: String(r.day).slice(5, 10),
              total: Math.round(Number(r.revenue ?? 0) * 100) / 100,
              ok: Math.round(Number(r.profit ?? 0) * 100) / 100,
            }))}
          />
        </div>
        <div className="mt-4">
          <DataTable
            keyOf={(_, i) => String(i)}
            rows={fin}
            columns={[
              { key: 'day', label: 'Day', mono: true, render: (r) => String(r.day).slice(0, 10) },
              { key: 'revenue', label: 'Revenue', right: true, render: (r) => <Money value={r.revenue} /> },
              { key: 'cost', label: 'Cost', right: true, render: (r) => <Money value={r.cost} /> },
              { key: 'profit', label: 'Profit', right: true, render: (r) => <span className="text-emerald-300 font-semibold"><Money value={r.profit} /></span> },
            ]}
          />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="card card-pad">
          <div className="card-title">Delivery by country</div>
          <div className="card-sub">Last 7 days</div>
          <div className="mt-3 space-y-2.5">
            {del.by_country.map((r, i) => {
              const pct = Number(r.total) ? (Number(r.delivered) / Number(r.total)) * 100 : 100;
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{String(r.country ?? r.iso_code ?? '—')}</span>
                    <span className="text-muted tabular-nums">{r.delivered}/{r.total} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
            {!del.by_country.length && <div className="text-sm text-muted">No traffic yet.</div>}
          </div>
        </div>
        <div className="card card-pad">
          <div className="card-title">Delivery by vendor</div>
          <div className="card-sub">Last 7 days</div>
          <div className="mt-3 space-y-2.5">
            {del.by_vendor.map((r, i) => {
              const pct = Number(r.total) ? (Number(r.delivered) / Number(r.total)) * 100 : 100;
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{String(r.vendor ?? '—')}</span>
                    <span className="text-muted tabular-nums">{r.delivered}/{r.total} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
            {!del.by_vendor.length && <div className="text-sm text-muted">No traffic yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Traffic(): JSX.Element {
  const [d, setD] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = (): void => {
      api<{ realtime: Record<string, string> }>('/reports/dashboard')
        .then((r) => setD(r.realtime ?? {}))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const entries = Object.entries(d);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Live traffic"
        sub="Redis real-time counters · 2s refresh"
        actions={
          <span className="flex items-center gap-2 text-xs text-muted border border-line rounded-lg px-3 py-1.5 bg-panel">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-400" />
            </span>
            LIVE
          </span>
        }
      />
      {entries.length ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {entries.map(([k, v]) => (
            <div key={k} className="stat-card">
              <div className="stat-label">{k.replace(/_/g, ' ')}</div>
              <div className="stat-value text-emerald-300 tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card card-pad text-center py-16">
          <div className="mx-auto w-11 h-11 rounded-xl bg-panel2 border border-line flex items-center justify-center text-muted mb-3">
            <Icon name="pulse" size={20} />
          </div>
          <div className="font-semibold">Waiting for traffic…</div>
          <div className="text-sm text-muted mt-1">Counters appear here as soon as messages flow through the gateway.</div>
        </div>
      )}
    </div>
  );
}
