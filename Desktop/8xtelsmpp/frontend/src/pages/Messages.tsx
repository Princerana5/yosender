import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, token } from '../api';
import { PageHeader, DataTable, StatusBadge, Money } from '../components';

const BM_LABELS: Record<string, string> = {
  on_submission: 'On Submission', on_delivery: 'On Delivery Only',
  submission_delivery: 'Submission + Delivery', operator_submission: 'Operator Submission',
  operator_delivery: 'Operator Delivery', hybrid: 'Hybrid: Sub + Op Deliv',
  on_attempt: 'On Attempt', on_accepted: 'On Accepted',
};

interface Msg {
  id: string; client_name: string; vendor_name: string | null; blending_vendor_name: string | null; source: string;
  destination: string; country_name: string | null; status: string;
  client_price: string | null; vendor_cost: string | null;
  error_description: string | null;
  billing_mode: string | null; billing_status: string | null; billed_amount: string | null;
  submit_time: string; dlr_time: string | null;
  dlr_cutting_selected: boolean | null; dlr_cutting_delay_seconds: number | null;
  cut_queue_status: string | null; cut_delay_seconds: number | null;
  cut_original_status: string | null; cut_received_at: string | null; cut_release_at: string | null; cut_released_at: string | null;
}

interface DlrRow {
  message_id: string; vendor_msg_id: string | null; destination: string; source: string;
  client_name: string | null; vendor_name: string | null; blending_vendor_name: string | null;
  effective_vendor_name: string | null; vendor_status: string; client_status: string;
  billing_mode: string | null; billed_amount: string | null; created_at: string;
}

const STATUSES = ['submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'];
const API_BASE = import.meta.env.VITE_API_URL ?? '';

function CuttingCell({ m }: { m: Msg }): JSX.Element {
  const sel = !!m.dlr_cutting_selected;
  if (!sel) {
    return <span className="inline-flex items-center gap-1.5" title="Not selected — vendor DLR forwarded immediately, no delay">
      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">REAL</span>
      <span className="text-[11px] text-muted">direct</span>
    </span>;
  }
  const qs = m.cut_queue_status;
  const dly = m.cut_delay_seconds ?? m.dlr_cutting_delay_seconds ?? 0;
  const isQueued = qs === 'queued';
  const isReleased = qs === 'released';
  return (
    <span className="inline-flex flex-col gap-0.5" title={isQueued ? `Real vendor DLR received at ${m.cut_received_at ?? ''} — client will see ${m.cut_original_status ?? m.status} only at ${m.cut_release_at ?? ''} (delay ${dly}s). Message DID go to real vendor.` : isReleased ? `Real vendor DLR was ${m.cut_original_status} — shown to client after ${dly}s delay at ${m.cut_released_at ?? m.cut_release_at ?? ''}.` : `Selected for ${dly}s delay — awaiting vendor DLR`}>
      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${isQueued ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : isReleased ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' : 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20'}`}>
        CUT · {dly}s {isQueued ? 'QUEUED' : isReleased ? 'RELEASED' : 'PENDING'}
      </span>
      {isQueued && m.cut_release_at && <span className="text-[10px] text-amber-300/70">release {new Date(m.cut_release_at).toLocaleTimeString()}</span>}
      {isReleased && m.cut_original_status && <span className="text-[10px] text-muted">real DLR: {m.cut_original_status}</span>}
    </span>
  );
}

async function downloadExport(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m?.[1] ?? (path.includes('/dlr') ? 'dlr_logs.xlsx' : 'message_logs.xlsx');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function Messages(): JSX.Element {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'messages' | 'dlr'>('messages');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [dlrs, setDlrs] = useState<DlrRow[]>([]);
  const [f, setF] = useState({
    destination: '',
    status: '',
    message_id: searchParams.get('message_id') ?? '',
    from: '',
    to: '',
  });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');

  const load = (): void => {
    setLoading(true);
    if (tab === 'messages') {
      const p = new URLSearchParams();
      if (f.destination) p.set('destination', f.destination);
      if (f.status) p.set('status', f.status);
      if (f.message_id) p.set('message_id', f.message_id);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      api<{ messages: Msg[] }>(`/messages?${p}`)
        .then((r) => setMsgs(r.messages))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    } else {
      const p = new URLSearchParams();
      if (f.status) p.set('status', f.status);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      api<{ dlrs: DlrRow[] }>(`/messages/dlr/logs?${p}`)
        .then((r) => setDlrs(r.dlrs))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }
  };
  useEffect(load, [tab]);

  const hasFilters = !!(f.destination || f.status || f.message_id || f.from || f.to);

  function buildExportQuery(fmt: 'csv' | 'xlsx'): string {
    const p = new URLSearchParams();
    p.set('format', fmt);
    p.set('limit', '50000');
    if (tab === 'messages') {
      if (f.destination) p.set('destination', f.destination);
      if (f.status) p.set('status', f.status);
      if (f.message_id) p.set('message_id', f.message_id);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
    } else {
      if (f.status) p.set('status', f.status);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
    }
    return p.toString();
  }

  async function doExport(fmt: 'csv' | 'xlsx'): Promise<void> {
    const q = buildExportQuery(fmt);
    const path = tab === 'messages' ? `/messages/export?${q}` : `/messages/dlr/logs/export?${q}`;
    setExporting(fmt);
    try { await downloadExport(path); } catch (e) { alert((e as Error).message); } finally { setExporting(''); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Message logs"
        sub={tab === 'messages'
          ? 'Every message goes to the real vendor — CUT rows are the same vendor DLR, just delayed before the client sees it'
          : 'Vendor receipt → client-visible outcome · filtered by status and time'}
        actions={
          <div className="flex items-center gap-1.5">
            <button
              className={`btn-ghost !py-1.5 !text-xs ${exporting ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={() => doExport('csv')}
              title="Download filtered rows as CSV (Excel-compatible, up to 50k)">
              {exporting === 'csv' ? 'Exporting…' : '⬇ CSV'}
            </button>
            <button
              className={`btn !py-1.5 !text-xs ${exporting ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={() => doExport('xlsx')}
              title="Download filtered rows as styled XLSX (frozen header + filters, up to 50k)">
              {exporting === 'xlsx' ? 'Exporting…' : '⬇ Excel'}
            </button>
          </div>
        }
      />

      {/* Tab switcher: NOC needs both */}
      <div className="flex gap-1 p-1 bg-panel border border-line rounded-xl w-fit">
        <button
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${tab === 'messages' ? 'bg-brand text-white shadow' : 'text-muted hover:text-white'}`}
          onClick={() => setTab('messages')}>
          Message logs {tab === 'messages' ? `· ${msgs.length}` : ''}
        </button>
        <button
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${tab === 'dlr' ? 'bg-brand text-white shadow' : 'text-muted hover:text-white'}`}
          onClick={() => setTab('dlr')}>
          DLR logs {tab === 'dlr' ? `· ${dlrs.length}` : ''}
        </button>
      </div>

      <div className="card card-pad flex flex-wrap gap-2 items-end">
        {tab === 'messages' && (
          <>
            <div className="w-48">
              <label className="label">Destination</label>
              <input className="input font-mono" placeholder="9198…" value={f.destination}
                onChange={(e) => setF({ ...f, destination: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && load()} />
            </div>
            <div className="w-64">
              <label className="label">Message ID</label>
              <input className="input font-mono" placeholder="internal / vendor / client id" value={f.message_id}
                onChange={(e) => setF({ ...f, message_id: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && load()} />
            </div>
          </>
        )}
        <div className="w-40">
          <label className="label">Status</label>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="label">From</label>
          <input className="input" type="datetime-local" value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })} />
        </div>
        <div className="w-40">
          <label className="label">To</label>
          <input className="input" type="datetime-local" value={f.to}
            onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Searching…' : 'Apply filters'}</button>
        {hasFilters && (
          <button className="btn-ghost" onClick={() => { setF({ destination: '', status: '', message_id: '', from: '', to: '' }); setTimeout(load, 0); }}>
            Clear
          </button>
        )}
        <span className="text-[11px] text-muted ml-auto hidden md:inline">Export respects current filters · max 50k rows</span>
      </div>

      {tab === 'messages' ? (
        <>
          <div className="flex gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-bold">REAL</span> = went to vendor, DLR shown immediately</span>
            <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">CUT · QUEUED</span> = same vendor DLR, waiting {`{delay}s`}</span>
            <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 font-bold">CUT · RELEASED</span> = DLR released after delay</span>
          </div>

          <DataTable
            keyOf={(m) => m.id}
            rows={msgs}
            empty="No messages match these filters."
            columns={[
              { key: 'id', label: 'ID', mono: true, render: (m) => m.id.slice(0, 8) },
              { key: 'client_name', label: 'Client' },
              { key: 'vendor_name', label: 'Vendor', render: (m) => {
                const blend = m.blending_vendor_name;
                if (blend) return <span title="Carried by blending vendor, not route head">{blend} <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">BLEND</span></span>;
                return m.vendor_name ?? <span className="text-muted">—</span>;
              } },
              {
                key: 'destination', label: 'Route', mono: true,
                render: (m) => <span>{m.source} <span className="text-muted">→</span> {m.destination}</span>,
              },
              { key: 'status', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
              { key: 'cut', label: 'Cutting', render: (m) => <CuttingCell m={m} /> },
              { key: 'client_price', label: 'Price', right: true, render: (m) => m.status === 'rejected' ? <span className="tabular-nums text-muted" title="Rejected — non chargeable">€0.00 <span className="text-[10px]">· non chargeable</span></span> : <Money value={m.client_price} /> },
              { key: 'vendor_cost', label: 'Cost', right: true, render: (m) => m.status === 'rejected' ? <span className="tabular-nums text-muted">—</span> : <Money value={m.vendor_cost} /> },
              {
                key: 'billing_mode', label: 'Billing Mode',
                render: (m) => <span className="text-xs whitespace-nowrap">{BM_LABELS[m.billing_mode ?? ''] ?? <span className="text-muted">—</span>}</span>,
              },
              {
                key: 'billing_status', label: 'Billed',
                render: (m) => <span className="text-xs whitespace-nowrap">{m.billing_status ?? '—'}{m.billed_amount ? ` (${m.billed_amount})` : ''}</span>,
              },
              {
                key: 'submit_time', label: 'Submitted',
                render: (m) => <span className="text-xs text-muted whitespace-nowrap">{new Date(m.submit_time).toLocaleString()}</span>,
              },
              {
                key: 'dlr_time', label: 'DLR',
                render: (m) => <span className="text-xs text-muted whitespace-nowrap">{m.dlr_time ? new Date(m.dlr_time).toLocaleString() : '—'}</span>,
              },
            ]}
          />
        </>
      ) : (
        <DataTable
          keyOf={(r) => r.message_id}
          rows={dlrs}
          empty="No DLRs match these filters."
          columns={[
            { key: 'vendor_msg_id', label: 'Vendor ID', mono: true, render: (r) => <span className="font-mono text-[12px]">{String(r.vendor_msg_id ?? '—').slice(0, 18)}</span> },
            { key: 'destination', label: 'To', mono: true, render: (r) => <span>{r.source} <span className="text-muted">→</span> {r.destination}</span> },
            { key: 'effective_vendor_name', label: 'Vendor', render: (r) => r.effective_vendor_name ?? <span className="text-muted">—</span> },
            { key: 'vendor_status', label: 'Vendor', render: (r) => <StatusBadge status={r.vendor_status} /> },
            { key: 'client_status', label: 'Client', render: (r) => <StatusBadge status={r.client_status} /> },
            { key: 'billing_mode', label: 'Billing', render: (r) => <span className="text-[11px] text-muted whitespace-nowrap">{r.billing_mode ? r.billing_mode.replace(/^on_/, '').replace(/_/g, ' ') : '—'}{r.billed_amount ? <span className="block tabular-nums">{String(r.billed_amount)}</span> : null}</span> },
            { key: 'created_at', label: 'Time', render: (r) => <span className="text-xs text-muted whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</span> },
          ]}
        />
      )}
    </div>
  );
}
