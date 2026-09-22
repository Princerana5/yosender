import { useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE, fmtMoney } from '../api';
import { PageHeader, DataTable, StatusBadge, StatCard, Bars } from '../components';

interface ClientOpt {
  id: string; name: string; system_id: string; portal_email?: string | null;
  company_name?: string | null;
}

interface ClientInfo {
  id: string; name: string; company_name: string | null; system_id: string;
  portal_email: string | null; status: string; currency: string;
  billing_mode: string; balance: string; sms_credits: string;
}

interface Summary {
  total: number; delivered: number; failed: number; pending: number;
  credit_used: number; credits_used: number; segments: number;
  avg_daily: number; avg_daily_credit: number;
}

interface DayRow {
  day: string; total: string; delivered: string; failed: string;
  credit_used: string; credits_used: string; segments: string;
}

interface Msg {
  id: string; created_at: string; source: string; destination: string;
  status: string; text: string | null; country_name: string | null;
  iso_code: string | null; vendor_name: string | null; route_name: string | null;
  segments: number | null; client_price: string | null;
  credits_charged: string | null; error_description: string | null;
}

type Preset = 'today' | 'yesterday' | 'last7' | 'last30' | 'month' | 'custom';

const PRESETS: Array<[Preset, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last7', 'Last 7 days'],
  ['last30', 'Last 30 days'],
  ['month', 'This month'],
  ['custom', 'Custom'],
];

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export default function ClientReports(): JSX.Element {
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date()));
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DayRow[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [msgTotal, setMsgTotal] = useState(0);
  const [msgOffset, setMsgOffset] = useState(0);
  const [mf, setMf] = useState({ destination: '', sender: '', status: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showContent, setShowContent] = useState(false);
  const [exporting, setExporting] = useState('');
  const abort = useRef(false);

  useEffect(() => {
    api<{ clients: ClientOpt[] }>('/clients')
      .then((r) => setClients(r.clients))
      .catch(() => undefined);
  }, []);

  const rangeParams = useMemo(() => {
    const p = new URLSearchParams();
    if (preset === 'custom') {
      if (from) p.set('from', from);
      if (to) p.set('to', to);
    } else {
      p.set('preset', preset);
    }
    return p.toString();
  }, [preset, from, to]);

  const rangeLabel = useMemo(() => {
    if (preset === 'custom') return `${from || '…'} → ${to || '…'}`;
    return PRESETS.find(([v]) => v === preset)?.[1] ?? preset;
  }, [preset, from, to]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients.slice(0, 100);
    return clients.filter((c) =>
      c.name.toLowerCase().includes(needle) ||
      c.system_id.toLowerCase().includes(needle) ||
      (c.portal_email ?? '').toLowerCase().includes(needle) ||
      (c.company_name ?? '').toLowerCase().includes(needle) ||
      c.id.toLowerCase().startsWith(needle),
    ).slice(0, 100);
  }, [clients, q]);

  const selected = clients.find((c) => c.id === clientId) ?? null;
  const creditMode = info?.billing_mode === 'credit';

  function load(offset = 0): void {
    if (!clientId) return;
    abort.current = false;
    setLoading(true);
    setErr('');
    const mp = new URLSearchParams(rangeParams);
    if (mf.destination) mp.set('destination', mf.destination);
    if (mf.sender) mp.set('sender', mf.sender);
    if (mf.status) mp.set('status', mf.status);
    mp.set('limit', '50');
    mp.set('offset', String(offset));
    Promise.all([
      api<{ client: ClientInfo; summary: Summary; range: { from: string; to: string } }>(
        `/reports/client/${clientId}/summary?${rangeParams}`,
      ),
      api<{ daily: DayRow[] }>(`/reports/client/${clientId}/daily?${rangeParams}`),
      api<{ messages: Msg[]; total: number }>(`/reports/client/${clientId}/messages?${mp}`),
    ])
      .then(([s, d, m]) => {
        if (abort.current) return;
        setInfo(s.client);
        setSummary(s.summary);
        setDaily(d.daily);
        setMsgs(m.messages);
        setMsgTotal(m.total);
        setMsgOffset(offset);
      })
      .catch((e) => {
        if (!abort.current) setErr((e as Error).message);
      })
      .finally(() => {
        if (!abort.current) setLoading(false);
      });
  }

  useEffect(() => {
    if (clientId) load(0);
    else {
      setInfo(null);
      setSummary(null);
      setDaily([]);
      setMsgs([]);
    }
    return () => {
      abort.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, rangeParams]);

  function download(format: 'csv' | 'xls' | 'pdf'): void {
    if (!clientId) return;
    setExporting(format);
    if (format === 'pdf') {
      window.print();
      setExporting('');
      return;
    }
    const a = document.createElement('a');
    const token = localStorage.getItem('xtel_token');
    const url = `${API_BASE}/reports/client/${clientId}/export?format=${format}&${rangeParams}`;
    fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('export failed');
        return r.blob();
      })
      .then((b) => {
        const obj = URL.createObjectURL(b);
        const safe = (selected?.name ?? 'client').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        a.href = obj;
        a.download = `${safe}_Traffic_Report_${format === 'xls' ? 'range' : rangeParams.replace(/[^0-9a-z-]/gi, '_')}.${format === 'xls' ? 'xls' : 'csv'}`;
        a.click();
        URL.revokeObjectURL(obj);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setExporting(''));
  }

  const chartData = useMemo(
    () => daily.map((d) => ({
      label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      total: Number(d.total),
      ok: Number(d.delivered),
    })),
    [daily],
  );

  const maxCredit = Math.max(1, ...daily.map((d) => Number(d.credit_used)));
  const creditTotal = daily.reduce((s, d) => s + Number(d.credit_used), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Client reports"
        sub="Per-client traffic, date-wise credit usage and detail — from actual records"
        actions={
          clientId ? (
            <span className="flex gap-2">
              <button className="btn-ghost !py-1.5 !text-xs" disabled={!!exporting} onClick={() => download('csv')}>
                {exporting === 'csv' ? '…' : '⬇ CSV'}
              </button>
              <button className="btn-ghost !py-1.5 !text-xs" disabled={!!exporting} onClick={() => download('xls')}>
                {exporting === 'xls' ? '…' : '⬇ Excel'}
              </button>
              <button className="btn !py-1.5 !text-xs" onClick={() => download('pdf')}>
                ⬇ PDF (print)
              </button>
            </span>
          ) : undefined
        }
      />

      {/* client selector */}
      <div className="card card-pad">
        <label className="label">Client — search by name, username, ID or email</label>
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-sm" placeholder="Type to search…"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="input max-w-md flex-1 min-w-[240px]"
            value={clientId} onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">— Select a client —</option>
            {filtered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.system_id}{c.portal_email ? ` · ${c.portal_email}` : ''}
              </option>
            ))}
          </select>
        </div>
        {info && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span><b className="text-gray-200">{info.name}</b>{info.company_name ? ` · ${info.company_name}` : ''}</span>
            <span className="font-mono">{info.system_id}</span>
            {info.portal_email && <span>{info.portal_email}</span>}
            <span>Status: <b className="text-gray-200">{info.status}</b></span>
            <span>Billing: <b className="text-gray-200">{info.billing_mode}</b></span>
            <span>Balance: <b className="text-emerald-300">{creditMode ? `${Number(info.sms_credits).toLocaleString()} credits` : fmtMoney(info.balance, info.currency)}</b></span>
          </div>
        )}
      </div>

      {!clientId ? (
        <div className="card card-pad text-center text-sm text-muted py-10">
          Select a client above to view their traffic and credit usage.
        </div>
      ) : (
        <>
          {/* date range */}
          <div className="card card-pad flex flex-wrap gap-2 items-end">
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map(([v, l]) => (
                <button
                  key={v} onClick={() => setPreset(v)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${preset === v
                    ? 'border-brand/50 bg-brand/10 text-emerald-300'
                    : 'border-line text-muted hover:text-white'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <>
                <div className="w-44">
                  <label className="label">From</label>
                  <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="w-44">
                  <label className="label">To</label>
                  <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </>
            )}
            <span className="ml-auto text-[11px] text-muted">
              {loading ? 'Loading…' : `Range: ${rangeLabel}`}
            </span>
          </div>

          {err && (
            <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{err}</div>
          )}

          {/* summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard label="Total traffic" value={(summary?.total ?? 0).toLocaleString()} />
            <StatCard label="Delivered" value={(summary?.delivered ?? 0).toLocaleString()} tone="brand" />
            <StatCard label="Failed" value={(summary?.failed ?? 0).toLocaleString()} tone={(summary?.failed ?? 0) ? 'danger' : undefined} />
            <StatCard
              label={creditMode ? 'Credits used' : 'Credit used'}
              value={creditMode ? (summary?.credits_used ?? 0).toLocaleString() : fmtMoney(summary?.credit_used ?? 0, info?.currency)}
              tone="accent"
            />
            <StatCard
              label="Current balance"
              value={creditMode ? Number(info?.sms_credits ?? 0).toLocaleString() : fmtMoney(info?.balance ?? 0, info?.currency)}
            />
            <StatCard label="Avg daily msgs" value={String(summary?.avg_daily ?? 0)} />
          </div>

          {/* charts */}
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="card card-pad">
              <div className="card-title">{creditMode ? 'Credits used per day' : 'Credit used per day'}</div>
              <div className="card-sub">From settled records · total {creditMode ? creditTotal.toLocaleString() + ' credits' : fmtMoney(creditTotal, info?.currency)}</div>
              <div className="mt-3 space-y-1.5 max-h-56 overflow-y-auto">
                {daily.length ? daily.map((d) => (
                  <div key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-muted tabular-nums">
                      {new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                    <div className="flex-1 h-4 rounded bg-panel2 overflow-hidden">
                      <div
                        className="h-full rounded bg-brand/70"
                        style={{ width: `${Math.max(2, (Number(creditMode ? d.credits_used : d.credit_used) / Math.max(1, creditMode ? Math.max(1, ...daily.map((x) => Number(x.credits_used))) : maxCredit)) * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 text-right tabular-nums font-semibold">
                      {creditMode ? Number(d.credits_used).toLocaleString() : fmtMoney(d.credit_used, info?.currency)}
                    </span>
                  </div>
                )) : <div className="text-sm text-muted py-6 text-center">No usage in this range.</div>}
              </div>
            </div>
            <div className="card card-pad">
              <div className="card-title">Traffic volume per day</div>
              <div className="card-sub">Messages per day · green share delivered</div>
              <div className="mt-3">
                <Bars data={chartData} />
              </div>
            </div>
          </div>

          {/* date-wise table */}
          <div>
            <div className="card-title mb-2 px-1">Date-wise credit usage</div>
            <DataTable
              keyOf={(r) => r.day}
              rows={daily}
              empty={loading ? 'Loading…' : 'No traffic in this range.'}
              columns={[
                {
                  key: 'day', label: 'Date',
                  render: (r) => <span className="font-semibold">{new Date(`${r.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>,
                },
                { key: 'total', label: 'Traffic', right: true, render: (r) => <span className="tabular-nums">{Number(r.total).toLocaleString()}</span> },
                { key: 'delivered', label: 'Delivered', right: true, render: (r) => <span className="tabular-nums text-emerald-300">{Number(r.delivered).toLocaleString()}</span> },
                { key: 'failed', label: 'Failed', right: true, render: (r) => <span className="tabular-nums text-red-300">{Number(r.failed).toLocaleString()}</span> },
                {
                  key: 'credit', label: creditMode ? 'Credits used' : 'Credit used', right: true,
                  render: (r) => <span className="tabular-nums font-semibold">{creditMode ? Number(r.credits_used).toLocaleString() : fmtMoney(r.credit_used, info?.currency)}</span>,
                },
                { key: 'segments', label: 'Segments', right: true, render: (r) => <span className="tabular-nums text-muted">{Number(r.segments).toLocaleString()}</span> },
              ]}
            />
          </div>

          {/* detail table */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="card-title">Detailed traffic <span className="text-muted font-normal">· {msgTotal.toLocaleString()} in range</span></div>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setShowContent((s) => !s)}>
                {showContent ? '🙈 Hide content' : '👁 Show content'}
              </button>
            </div>
            <div className="card card-pad flex flex-wrap gap-2 items-end mb-3">
              <div className="w-52">
                <label className="label">Destination</label>
                <input className="input font-mono" placeholder="9198…" value={mf.destination}
                  onChange={(e) => setMf({ ...mf, destination: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && load(0)} />
              </div>
              <div className="w-44">
                <label className="label">Sender</label>
                <input className="input font-mono" placeholder="SENDER" value={mf.sender}
                  onChange={(e) => setMf({ ...mf, sender: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && load(0)} />
              </div>
              <div className="w-44">
                <label className="label">Status</label>
                <select className="input" value={mf.status} onChange={(e) => setMf({ ...mf, status: e.target.value })}>
                  <option value="">All</option>
                  {['submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <button className="btn" onClick={() => load(0)} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
              {(mf.destination || mf.sender || mf.status) && (
                <button className="btn-ghost" onClick={() => { setMf({ destination: '', sender: '', status: '' }); }}>Clear</button>
              )}
            </div>
            <DataTable
              keyOf={(m) => m.id}
              rows={msgs}
              empty={loading ? 'Loading…' : 'No messages match.'}
              columns={[
                {
                  key: 'created_at', label: 'Date · Time',
                  render: (m) => {
                    const d = new Date(m.created_at);
                    return <span className="text-xs text-muted whitespace-nowrap">{d.toLocaleDateString()} {d.toLocaleTimeString()}</span>;
                  },
                },
                { key: 'route_name', label: 'Service / Route', render: (m) => <span className="text-xs">{m.route_name ?? '—'}</span> },
                { key: 'source', label: 'Sender', mono: true },
                {
                  key: 'destination', label: 'Destination', mono: true,
                  render: (m) => <span>{m.destination}{m.country_name ? <span className="block text-[10px] text-muted">{m.iso_code} · {m.country_name}</span> : null}</span>,
                },
                {
                  key: 'text', label: 'Content',
                  render: (m) => {
                    if (!showContent) return <span className="text-muted text-xs">hidden</span>;
                    return <span className="text-xs max-w-[200px] block truncate" title={m.text ?? ''}>{m.text ?? '—'}</span>;
                  },
                },
                { key: 'vendor_name', label: 'Vendor', render: (m) => m.vendor_name ?? <span className="text-muted">…</span> },
                { key: 'status', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
                {
                  key: 'client_price', label: creditMode ? 'Credits' : 'Charged', right: true,
                  render: (m) => <span className="tabular-nums">{creditMode ? Number(m.credits_charged ?? 0).toLocaleString() : fmtMoney(m.client_price, info?.currency)}</span>,
                },
              ]}
            />
            {msgTotal > 50 && (
              <div className="flex items-center gap-2 mt-2 text-xs text-muted">
                <button className="btn-ghost !py-1 !text-xs" disabled={msgOffset === 0 || loading} onClick={() => load(Math.max(0, msgOffset - 50))}>← Prev</button>
                <span className="tabular-nums">{msgOffset + 1}–{Math.min(msgOffset + 50, msgTotal)} of {msgTotal.toLocaleString()}</span>
                <button className="btn-ghost !py-1 !text-xs" disabled={msgOffset + 50 >= msgTotal || loading} onClick={() => load(msgOffset + 50)}>Next →</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
