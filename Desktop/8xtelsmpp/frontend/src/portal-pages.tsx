import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { portalApi, API_BASE } from './portal';
import { PageHeader, DataTable, StatusBadge, Money, Modal, StatCard, Donut } from './components';

// ── Portal: send SMS (single / bulk / file + segment meter) ───────────────────
type SendTab = 'single' | 'bulk' | 'file';

interface Estimate {
  text: string; encoding: string; units: number; segments: number;
  chars_left: number; non_gsm_chars: string[]; normalized: boolean;
  normalized_chars: string[]; numbers: number; total_segments: number;
  unit_price: number; price_source?: string; estimated_cost: number;
}

const CONFETTI_COLORS = ['#10b981', '#34d399', '#38bdf8', '#fbbf24', '#f472b6', '#a78bfa', '#ffffff'];

function Confetti({ pieces = 60 }: { pieces?: number }): JSX.Element {
  const [items] = useState(() => Array.from({ length: pieces }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.9,
    duration: 2.2 + Math.random() * 1.8,
    size: 5 + Math.random() * 7,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: Math.random() > 0.6,
  })));
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {items.map((p) => (
        <span key={p.id} className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.5,
            background: p.color,
            borderRadius: p.round ? '50%' : 1,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }} />
      ))}
    </div>
  );
}

export function PortalSend(): JSX.Element {
  const [tab, setTab] = useState<SendTab>('single');
  const [senders, setSenders] = useState<Array<{ sender: string; status: string }>>([]);
  const [useCustom, setUseCustom] = useState(false);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [bulk, setBulk] = useState('');
  const [fileNums, setFileNums] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [fileInfo, setFileInfo] = useState('');
  const [text, setText] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [normalize, setNormalize] = useState(false);
  const [est, setEst] = useState<Estimate | null>(null);
  const [estBusy, setEstBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{
    campaign_id: string; encoding: string; segments: number;
    total: number; accepted: number; rejected: number;
    failed_numbers?: Array<{ number: string; reason: string }>;
  } | null>(null);

  useEffect(() => {
    portalApi<{ senders: Array<{ sender: string; status: string }> }>('/portal/senders')
      .then((r) => {
        const ok = r.senders.filter((s) => s.status === 'approved');
        setSenders(ok);
        if (ok.length && !source) setSource(ok[0].sender);
        else if (!ok.length) setUseCustom(true);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live estimate (debounced)
  useEffect(() => {
    if (!text) {
      setEst(null);
      return;
    }
    setEstBusy(true);
    const count = tab === 'single' ? 1 : tab === 'bulk'
      ? Math.max(1, bulk.split(/[,;\s\n\r\t|]+/).filter(Boolean).length)
      : Math.max(1, fileNums.length);
    const t = setTimeout(() => {
      const sample = tab === 'single' ? destination.trim()
        : tab === 'bulk' ? (bulk.split(/[,;\s\n\r\t|]+/).filter(Boolean)[0] ?? '')
        : (fileNums[0] ?? '');
      portalApi<Estimate>('/portal/estimate', {
        method: 'POST',
        body: JSON.stringify({
          text, normalize, numbers: Math.min(count, 50000),
          destination: sample || undefined, source: source || undefined,
        }),
      })
        .then(setEst)
        .catch(() => undefined)
        .finally(() => setEstBusy(false));
    }, 400);
    return () => clearTimeout(t);
  }, [text, normalize, bulk, fileNums, tab, destination, source]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setFileInfo('');
    setFileNums([]);
    const fd = new FormData();
    fd.append('file', f);
    try {
      const token = localStorage.getItem('xtel_portal_token');
      const res = await fetch(`${API_BASE}/portal/parse-file`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'parse failed');
      setFileNums(body.numbers ?? []);
      setFileInfo(
        `${(body.total as number).toLocaleString()} valid numbers` +
        (body.invalid?.length ? ` · ${body.invalid.length} invalid skipped` : '') +
        (body.truncated ? ' · capped at 10,000' : ''),
      );
    } catch (e) {
      setFileInfo((e as Error).message);
    }
  }

  const destCount = tab === 'single' ? (destination.trim() ? 1 : 0) : tab === 'bulk'
    ? bulk.split(/[,;\s\n\r\t|]+/).filter(Boolean).length
    : fileNums.length;

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr('');
    setResult(null);
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        source, text: est?.text ?? text, normalize: false,
      };
      if (campaignName.trim()) payload.name = campaignName.trim();
      if (tab === 'single') payload.destinations = [destination.trim()];
      else if (tab === 'bulk') payload.bulk = bulk;
      else payload.destinations = fileNums;
      const r = await portalApi<typeof result & { campaign_id: string }>('/portal/campaigns', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const canSend = source && text && destCount > 0 && destCount <= 10000 && !sending;

  return (
    <div className="space-y-5">
      <PageHeader title="Send SMS" sub="Single, bulk or file upload · live segment + cost preview" />

      <div className="grid lg:grid-cols-5 gap-3">
        <div className="card card-pad lg:col-span-3">
          {/* tabs */}
          <div className="flex gap-1.5 mb-4">
            {([['single', 'Single'], ['bulk', 'Bulk'], ['file', 'File']] as Array<[SendTab, string]>).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setTab(v)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${tab === v
                  ? 'border-brand/50 bg-brand/10 text-emerald-300'
                  : 'border-line text-muted hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>

          <form onSubmit={send} className="space-y-4">
            {/* sender */}
            <div>
              <label className="label">Sender ID</label>
              {senders.length && !useCustom ? (
                <div className="flex gap-2">
                  <select className="input font-mono flex-1" value={source} onChange={(e) => setSource(e.target.value)}>
                    {senders.map((s) => <option key={s.sender} value={s.sender}>{s.sender} (approved)</option>)}
                  </select>
                  <button type="button" className="btn-ghost shrink-0 !text-xs" onClick={() => { setUseCustom(true); setSource(''); }}>
                    Enter other
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input className="input font-mono flex-1" value={source}
                    onChange={(e) => setSource(e.target.value)} maxLength={21} placeholder="Your sender ID" />
                  {!!senders.length && (
                    <button type="button" className="btn-ghost shrink-0 !text-xs" onClick={() => { setUseCustom(false); setSource(senders[0].sender); }}>
                      Use approved
                    </button>
                  )}
                </div>
              )}
              <p className="text-[11px] text-muted mt-1">Approved IDs send instantly · others may be held by filters.</p>
            </div>

            {/* campaign name */}
            <div>
              <label className="label">Campaign name <span className="text-gray-600">(saved with this send · shown in reports)</span></label>
              <input className="input" value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)} maxLength={120}
                placeholder="e.g. Diwali promo — Mumbai list" />
            </div>

            {/* destinations per tab */}
            {tab === 'single' && (
              <div>
                <label className="label">To (one number)</label>
                <input className="input font-mono" value={destination}
                  onChange={(e) => setDestination(e.target.value)} placeholder="919876543210" />
              </div>
            )}
            {tab === 'bulk' && (
              <div>
                <label className="label">Numbers (paste · commas / lines / spaces · up to 10,000)</label>
                <textarea className="input font-mono min-h-[120px]" value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  placeholder={'919800000001\n919800000002, 919800000003'} />
                {!!destCount && <div className="text-[11px] text-muted mt-1 tabular-nums">{destCount.toLocaleString()} numbers pasted</div>}
              </div>
            )}
            {tab === 'file' && (
              <div>
                <label className="label">Numbers file (.txt / .csv — save Excel as CSV)</label>
                <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-line hover:border-brand/50 transition cursor-pointer px-4 py-8 text-sm text-muted hover:text-white">
                  <input type="file" accept=".txt,.csv" className="hidden" onChange={onFile} />
                  {fileName ? <span className="font-mono text-gray-200">{fileName}</span> : <span>Click to upload · first column used · max 10,000</span>}
                </label>
                {fileInfo && <div className="text-[11px] text-muted mt-1">{fileInfo}</div>}
              </div>
            )}

            {/* message */}
            <div>
              <label className="label">Message</label>
              <textarea className="input min-h-[140px]" value={text}
                onChange={(e) => setText(e.target.value)} maxLength={2000} />
              <label className="flex items-center gap-2 mt-2 text-xs text-muted cursor-pointer">
                <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="accent-emerald-500" />
                Fit in fewer segments — replace ş→s, ğ→g, “→", —→- etc.
              </label>
            </div>

            {err && (
              <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{err}</div>
            )}
            {result && (
              <div className="modal-backdrop celebrate-backdrop" onClick={() => setResult(null)}>
                <Confetti />
                <div className="celebrate-card relative rounded-2xl border border-brand/40 bg-gradient-to-br from-brand/20 via-panel to-panel px-6 py-7 max-w-md w-full text-center"
                  onClick={(e) => e.stopPropagation()}>
                  <span className="celebrate-check mx-auto flex items-center justify-center w-16 h-16 rounded-full bg-brand/20 border-2 border-brand/60 text-emerald-300 text-3xl">
                    ✓
                  </span>
                  <div className="mt-4 font-extrabold text-emerald-300 text-xl leading-tight">
                    Campaign pushed successfully! 🎉
                  </div>
                  <div className="mt-1.5 text-sm text-muted tabular-nums">
                    {result.accepted.toLocaleString()} of {result.total.toLocaleString()} numbers queued
                    {' '}· {result.segments} segment(s) · {result.encoding.toUpperCase()}
                  </div>
                  {result.rejected > 0 && (
                    <div className="mt-3 text-xs text-amber-300 bg-warn/10 border border-warn/25 rounded-lg px-3 py-2">
                      {result.rejected} number(s) couldn't be queued (blocked sender) — see the report for details.
                    </div>
                  )}
                  <div className="mt-4 rounded-lg bg-ink/60 border border-line px-3 py-2.5 text-xs text-muted">
                    📊 Delivery is happening now — statuses update live.
                  </div>
                  <div className="mt-4 flex gap-2">
                    <a className="btn flex-1" href={`/portal/reports/${result.campaign_id}`}>
                      Check report for delivery updates →
                    </a>
                    <button className="btn-ghost" onClick={() => setResult(null)}>Send more</button>
                  </div>
                </div>
              </div>
            )}
            <button className="btn w-full" type="submit" disabled={!canSend}>
              {sending ? 'Queueing…' : destCount > 1
                ? `✉ Send to ${destCount.toLocaleString()} numbers${est ? ` · ~${est.total_segments.toLocaleString()} segments` : ''}`
                : '✉ Send SMS'}
            </button>
          </form>
        </div>

        {/* segment meter */}
        <div className="lg:col-span-2">
          <div className="card card-pad sticky top-20">
            <div className="card-title">Segments & cost</div>
            <div className="card-sub">Live preview · billing is per segment</div>
            {!text ? (
              <div className="text-sm text-muted py-6 text-center">Type a message to see encoding, segments and cost.</div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`badge border ${est?.encoding === 'unicode'
                    ? 'bg-warn/15 text-amber-300 border-warn/30'
                    : 'bg-brand/15 text-emerald-300 border-brand/30'}`}>
                    {estBusy ? '…' : est?.encoding === 'unicode' ? 'UNICODE (UCS-2)' : 'GSM-7'}
                  </span>
                  <span className="text-2xl font-extrabold tabular-nums ml-auto">
                    {estBusy ? '…' : `${est?.segments ?? 1} seg`}
                  </span>
                </div>
                <div className="text-xs text-muted tabular-nums">
                  {est?.units} units · {est?.chars_left} left in this segment · {destCount.toLocaleString()} number(s) →{' '}
                  <b className="text-gray-200">{(est?.total_segments ?? 0).toLocaleString()} total segments</b>
                </div>
                {est && est.encoding === 'unicode' && est.non_gsm_chars.length > 0 && !normalize && (
                  <div className="text-xs text-amber-300 bg-warn/10 border border-warn/25 rounded-lg px-3 py-2">
                    ⚠ Unicode detected — triggered by: {est.non_gsm_chars.map((c) => `"${c}"`).join(' ')}.
                    {est.segments > 1
                      ? ` This message costs ${est.segments}× per number.`
                      : ' Still 1 segment, but any longer text splits at 67 chars.'}{' '}
                    Tick “fit in fewer segments” to normalize.
                  </div>
                )}
                {est?.normalized && (
                  <div className="text-xs text-emerald-300 bg-brand/5 border border-brand/25 rounded-lg px-3 py-2">
                    ✓ Normalized ({est.normalized_chars.map((c) => `"${c}"`).join(' ')}) — now {est.encoding === 'gsm7' ? 'GSM-7' : est.encoding}, {est.segments} segment(s).
                  </div>
                )}
                <div className="rounded-lg bg-ink/60 border border-line px-3 py-2.5 text-sm">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Est. cost</span>
                    <span title={est?.price_source}>rate {est?.unit_price ?? 0}/seg{est?.price_source ? ` · ${est.price_source}` : ''}</span>
                  </div>
                  <div className="text-lg font-bold tabular-nums">
                    {estBusy ? '…' : `≈ ${(est?.estimated_cost ?? 0).toFixed(4)}`}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Portal: history ──────────────────────────────────────────────────────────
interface HistMsg {
  id: string; source: string; destination: string; text: string; status: string;
  client_price: string | null; submit_time: string; dlr_time: string | null;
  created_at: string; country_name: string | null;
}

export function PortalHistory(): JSX.Element {
  const [msgs, setMsgs] = useState<HistMsg[]>([]);
  const [f, setF] = useState({ destination: '', status: '' });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<HistMsg | null>(null);

  const load = (): void => {
    setLoading(true);
    const p = new URLSearchParams();
    if (f.destination) p.set('destination', f.destination);
    if (f.status) p.set('status', f.status);
    portalApi<{ messages: HistMsg[] }>(`/portal/messages?${p}`)
      .then((r) => setMsgs(r.messages))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="space-y-5">
      <PageHeader title="History" sub="Your messages and delivery status" />
      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="w-56">
          <label className="label">Destination</label>
          <input className="input font-mono" placeholder="9198…" value={f.destination}
            onChange={(e) => setF({ ...f, destination: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div className="w-44">
          <label className="label">Status</label>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">All</option>
            {['submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </div>
      <DataTable
        keyOf={(m) => m.id}
        rows={msgs}
        empty="No messages yet."
        columns={[
          {
            key: 'created_at', label: 'Time',
            render: (m) => <span className="text-xs text-muted whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</span>,
          },
          {
            key: 'route', label: 'From → To', mono: true,
            render: (m) => <span>{m.source} <span className="text-muted">→</span> {m.destination}</span>,
          },
          {
            key: 'text', label: 'Message',
            render: (m) => (
              <button className="text-xs text-left max-w-[280px] truncate block hover:text-white"
                title="Click to view" onClick={() => setOpen(m)}>
                {m.text}
              </button>
            ),
          },
          { key: 'status', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
          { key: 'client_price', label: 'Cost', right: true, render: (m) => <Money value={m.client_price} /> },
        ]}
      />
      {open && (
        <Modal title="Message detail" onClose={() => setOpen(null)}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={open.status} />
              <span className="text-xs text-muted">{new Date(open.created_at).toLocaleString()}</span>
            </div>
            <div className="font-mono text-[13px]">{open.source} → {open.destination}</div>
            <div className="rounded-lg bg-ink border border-line p-3 whitespace-pre-wrap">{open.text}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted">Country:</span> {open.country_name ?? '…'}</div>
              <div><span className="text-muted">Cost:</span> <Money value={open.client_price} /></div>
              <div><span className="text-muted">Submitted:</span> {open.submit_time ? new Date(open.submit_time).toLocaleString() : '…'}</div>
              <div><span className="text-muted">Delivered:</span> {open.dlr_time ? new Date(open.dlr_time).toLocaleString() : '…'}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Portal: reports (campaign list → detail → per-number + CSV) ──────────────
interface Campaign {
  id: string; name: string; source: string; text: string; encoding: string;
  segments: number; unit_price: string | null; total_numbers: number;
  accepted: number; rejected: number; status: string; created_at: string;
  live_delivered: string; live_failed: string;
}

export function PortalReports(): JSX.Element {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [f, setF] = useState({ from: '', to: '' });

  const load = (): void => {
    const p = new URLSearchParams();
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    portalApi<{ campaigns: Campaign[] }>(`/portal/campaigns?${p}`)
      .then((r) => setRows(r.campaigns))
      .catch(() => undefined);
  };
  useEffect(load, []);

  const totals = rows.reduce(
    (s, c) => ({
      n: s.n + Number(c.total_numbers),
      d: s.d + Number(c.live_delivered),
      f: s.f + Number(c.live_failed),
    }),
    { n: 0, d: 0, f: 0 },
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" sub="Campaign overview · time & date wise · per-number detail" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Campaigns" value={String(rows.length)} />
        <StatCard label="Numbers pushed" value={totals.n.toLocaleString()} />
        <StatCard label="Delivered" value={totals.d.toLocaleString()} tone="brand" />
        <StatCard label="Failed" value={totals.f.toLocaleString()} tone={totals.f ? 'danger' : undefined} />
      </div>
      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="w-44">
          <label className="label">From date</label>
          <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </div>
        <div className="w-44">
          <label className="label">To date</label>
          <input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <button className="btn" onClick={load}>Apply</button>
        {(f.from || f.to) && (
          <button className="btn-ghost" onClick={() => { setF({ from: '', to: '' }); setTimeout(load, 0); }}>Clear</button>
        )}
      </div>
      <DataTable
        keyOf={(c) => c.id}
        rows={rows}
        empty="No campaigns yet — send your first SMS."
        columns={[
          {
            key: 'created_at', label: 'Time',
            render: (c) => <span className="text-xs text-muted whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</span>,
          },
          {
            key: 'name', label: 'Campaign',
            render: (c) => (
              <div>
                <Link className="font-semibold text-sky-300 hover:underline" to={`/portal/reports/${c.id}`}>{c.name}</Link>
                <div className="text-[11px] text-muted font-mono">{c.source} · {c.encoding} · {c.segments} seg</div>
              </div>
            ),
          },
          { key: 'total_numbers', label: 'Numbers', right: true, render: (c) => <span className="tabular-nums">{Number(c.total_numbers).toLocaleString()}</span> },
          { key: 'live_delivered', label: 'Delivered', right: true, render: (c) => <span className="tabular-nums text-emerald-300">{Number(c.live_delivered).toLocaleString()}</span> },
          { key: 'live_failed', label: 'Failed', right: true, render: (c) => <span className={`tabular-nums ${Number(c.live_failed) ? 'text-red-300' : 'text-muted'}`}>{Number(c.live_failed).toLocaleString()}</span> },
          {
            key: 'rate', label: 'DLR %', right: true,
            render: (c) => {
              const t = Number(c.total_numbers) || 1;
              return <span className="tabular-nums">{((Number(c.live_delivered) / t) * 100).toFixed(1)}%</span>;
            },
          },
        ]}
      />
    </div>
  );
}

interface CampaignNum {
  destination: string; source: string; text: string; status: string;
  client_price: string | null; submit_time: string; dlr_time: string | null;
  created_at: string; mnc: string | null; mcc: string | null; operator_name: string | null;
  vendor_msg_id: string | null; error_code: string | null; error_description: string | null;
  country_name: string | null; iso_code: string | null;
  operator_status: string | null; final_status: string | null;
}

export function PortalReportDetail(): JSX.Element {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [mix, setMix] = useState({ delivered: '0', failed: '0', pending: '0' });
  const [nums, setNums] = useState<CampaignNum[]>([]);
  const [f, setF] = useState({ destination: '', status: '' });
  const [loading, setLoading] = useState(false);

  const load = (): void => {
    if (!id) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (f.destination) p.set('destination', f.destination);
    if (f.status) p.set('status', f.status);
    portalApi<{ campaign: Campaign; mix: typeof mix; numbers: CampaignNum[] }>(`/portal/campaigns/${id}?${p}`)
      .then((r) => {
        setCampaign(r.campaign);
        setMix(r.mix);
        setNums(r.numbers);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  function download(): void {
    const token = localStorage.getItem('xtel_portal_token');
    fetch(`${API_BASE}/portal/campaigns/${id}/export`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error('export failed');
        return r.blob();
      })
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = `campaign-${String(id).slice(0, 8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => undefined);
  }

  if (!campaign) {
    return <div className="card card-pad animate-pulse"><div className="h-6 w-48 bg-line rounded" /></div>;
  }
  const d = Number(mix.delivered);
  const fl = Number(mix.failed);
  const p = Number(mix.pending);
  const total = d + fl + p;

  return (
    <div className="space-y-5">
      <PageHeader
        title={campaign.name}
        sub={`${new Date(campaign.created_at).toLocaleString()} · ${campaign.source} · ${campaign.encoding} · ${campaign.segments} segment(s)`}
        actions={
          <span className="flex gap-2">
            <Link className="btn-ghost !py-1.5 !text-xs" to="/portal/reports">← All reports</Link>
            <button className="btn !py-1.5 !text-xs" onClick={download}>⬇ Download Excel (CSV)</button>
          </span>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Numbers" value={Number(campaign.total_numbers).toLocaleString()} />
        <StatCard label="Delivered" value={d.toLocaleString()} tone="brand" />
        <StatCard label="Failed" value={fl.toLocaleString()} tone={fl ? 'danger' : undefined} />
        <StatCard label="Pending" value={p.toLocaleString()} />
      </div>
      {!!total && (
        <div className="card card-pad">
          <div className="card-title">Delivery mix</div>
          <div className="mt-3 max-w-xs">
            <Donut
              center={`${((d / total) * 100).toFixed(0)}%`}
              slices={[
                { value: d, color: '#10b981', label: 'Delivered' },
                { value: fl, color: '#ef4444', label: 'Failed' },
                { value: p, color: '#38bdf8', label: 'Pending' },
              ]}
            />
          </div>
        </div>
      )}
      <div className="rounded-lg border border-line bg-panel/60 px-3 py-2.5 text-xs">
        <span className="text-muted">Content:</span>{' '}
        <span className="whitespace-pre-wrap">{campaign.text}</span>
      </div>
      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="w-56">
          <label className="label">Specific number</label>
          <input className="input font-mono" placeholder="9198…" value={f.destination}
            onChange={(e) => setF({ ...f, destination: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div className="w-44">
          <label className="label">Status</label>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">All</option>
            {['submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </div>
      <DataTable
        keyOf={(m, i) => `${m.destination}-${i}`}
        rows={nums}
        empty="No numbers match."
        columns={[
          { key: 'destination', label: 'Number', mono: true },
          { key: 'country_name', label: 'Country', render: (m) => m.country_name ?? <span className="text-muted">…</span> },
          {
            key: 'operator', label: 'MNC / MCC / Operator', mono: true,
            render: (m) => m.mnc || m.mcc || m.operator_name
              ? <span className="text-[11px]">{[m.mcc, m.mnc].filter(Boolean).join('-') || '—'} {m.operator_name ?? ''}</span>
              : <span className="text-muted text-[11px]">—</span>,
          },
          { key: 'source', label: 'Sender', mono: true },
          {
            key: 'text', label: 'Content',
            render: (m) => <span className="text-xs max-w-[200px] block truncate" title={m.text}>{m.text}</span>,
          },
          { key: 'status', label: 'Pushed', render: (m) => <StatusBadge status={m.status} /> },
          {
            key: 'operator_status', label: 'Operator',
            render: (m) => m.operator_status
              ? <StatusBadge status={m.operator_status === 'DELIVRD' ? 'delivered' : 'unknown'} />
              : <span className="text-muted">…</span>,
          },
          {
            key: 'dlr_time', label: 'Time',
            render: (m) => <span className="text-xs text-muted whitespace-nowrap">{m.dlr_time ? new Date(m.dlr_time).toLocaleString() : '…'}</span>,
          },
          { key: 'client_price', label: 'Cost', right: true, render: (m) => <Money value={m.client_price} /> },
        ]}
      />
    </div>
  );
}

// ── Portal: coverage (routes available to me + country + rate) ───────────────
interface CoverageRoute {
  id: string; name: string; strategy: string; prefix: string | null;
  sender_id: string | null; price_per_segment: number | null;
  price_currency: string; price_source: string; dedicated: boolean;
  country_id: string | null; country_name: string | null;
  iso_code: string | null; calling_code: string | null;
}

interface RateCardRow {
  price: number; currency: string; country_id: string | null;
  country_name: string | null; iso_code: string | null;
  calling_code: string | null; prefix: string | null;
}

export function PortalCoverage(): JSX.Element {
  const [routes, setRoutes] = useState<CoverageRoute[]>([]);
  const [rates, setRates] = useState<RateCardRow[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [q, setQ] = useState('');

  useEffect(() => {
    portalApi<{ wallet_currency: string; routes: CoverageRoute[]; rate_card: RateCardRow[] }>('/portal/coverage')
      .then((r) => {
        setRoutes(r.routes);
        setRates(r.rate_card);
        setCurrency(r.wallet_currency);
      })
      .catch(() => undefined);
  }, []);

  const needle = q.trim().toLowerCase();
  const filt = routes.filter((r) =>
    !needle ||
    r.name.toLowerCase().includes(needle) ||
    (r.country_name ?? '').toLowerCase().includes(needle) ||
    (r.iso_code ?? '').toLowerCase().includes(needle) ||
    (r.calling_code ?? '').includes(needle),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Coverage & rates"
        sub={`Routes opened for your account · prices per segment in ${currency}`}
      />
      <div className="card card-pad flex gap-2 items-center">
        <input className="input max-w-sm" placeholder="Search route, country, ISO, code…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ml-auto text-[11px] text-muted">{filt.length} route(s)</span>
      </div>
      <DataTable
        keyOf={(r) => r.id}
        rows={filt}
        empty="No routes opened for your account yet — contact support."
        columns={[
          {
            key: 'route', label: 'Route',
            render: (r) => (
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-[11px] text-muted font-mono">{r.strategy}{r.prefix ? ` · prefix ${r.prefix}` : ''}</div>
              </div>
            ),
          },
          {
            key: 'country', label: 'Country',
            render: (r) => r.country_name ? (
              <span>
                <span className="font-mono text-[11px] bg-panel2 border border-line rounded px-1.5 py-0.5 mr-1.5">{r.iso_code}</span>
                {r.country_name}
                {r.calling_code && <span className="text-muted text-[11px]"> +{r.calling_code}</span>}
              </span>
            ) : <span className="text-muted">All countries</span>,
          },
          {
            key: 'price', label: `Price / seg (${currency})`, right: true,
            render: (r) => r.price_per_segment !== null ? (
              <span>
                <span className="tabular-nums font-semibold text-emerald-300">{Number(r.price_per_segment).toFixed(4)}</span>
                <span className="block text-[10px] text-muted font-normal">via {r.price_source}</span>
              </span>
            ) : <span className="text-muted text-xs">rate card ↓</span>,
          },
        ]}
      />
      {!!rates.length && (
        <div>
          <div className="card-title mb-2 px-1">Rate card fallback <span className="text-muted font-normal">· applies where a route has no price</span></div>
          <DataTable
            keyOf={(_, i) => String(i)}
            rows={rates}
            columns={[
              {
                key: 'country', label: 'Country',
                render: (r) => r.country_name ? (
                  <span>
                    <span className="font-mono text-[11px] bg-panel2 border border-line rounded px-1.5 py-0.5 mr-1.5">{r.iso_code}</span>
                    {r.country_name}
                  </span>
                ) : <span className="text-muted">Default</span>,
              },
              { key: 'prefix', label: 'Prefix', mono: true, render: (r) => r.prefix ?? <span className="text-muted">*</span> },
              {
                key: 'price', label: `Price / seg (${currency})`, right: true,
                render: (r) => <span className="tabular-nums font-semibold">{Number(r.price).toFixed(4)}</span>,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

// ── Portal: wallet (balance, ledger, top-up + sender requests) ───────────────
interface TopupReq {
  id: string; amount: string; note: string | null; status: string; created_at: string;
  reviewer_remark: string | null;
}
interface SenderReq {
  id: string; sender: string; country_name: string | null; status: string; created_at: string;
}

export function PortalWallet(): JSX.Element {
  const [wallet, setWallet] = useState<Record<string, string> | null>(null);
  const [txs, setTxs] = useState<Array<Record<string, string>>>([]);
  const [topups, setTopups] = useState<TopupReq[]>([]);
  const [senders, setSenders] = useState<Array<{ sender: string; status: string; country_name: string | null }>>([]);
  const [senderReqs, setSenderReqs] = useState<SenderReq[]>([]);
  const [amount, setAmount] = useState('100');
  const [note, setNote] = useState('');
  const [sender, setSender] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    portalApi<{ wallet: Record<string, string>; transactions: Array<Record<string, string>> }>('/portal/wallet')
      .then((r) => { setWallet(r.wallet); setTxs(r.transactions); }).catch(() => undefined);
    portalApi<{ requests: TopupReq[] }>('/portal/topup-requests')
      .then((r) => setTopups(r.requests)).catch(() => undefined);
    portalApi<{ senders: typeof senders; requests: SenderReq[] }>('/portal/senders')
      .then((r) => { setSenders(r.senders); setSenderReqs(r.requests); }).catch(() => undefined);
  };
  useEffect(load, []);

  async function requestTopup(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      await portalApi('/portal/topup-requests', {
        method: 'POST',
        body: JSON.stringify({ amount: Number(amount), note: note || undefined }),
      });
      setMsg('Top-up request sent — we will credit your wallet after payment.');
      setAmount('100');
      setNote('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestSender(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      await portalApi('/portal/sender-requests', {
        method: 'POST',
        body: JSON.stringify({ sender }),
      });
      setMsg(`Sender ID "${sender}" requested — we will approve it shortly.`);
      setSender('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Wallet" sub="Balance, ledger, top-ups and sender IDs" />
      {msg && (
        <div className="text-sm bg-brand/5 border border-brand/25 rounded-lg px-3 py-2.5">{msg}</div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="card card-pad">
          <div className="stat-label">Current balance</div>
          <div className="stat-value text-emerald-300">
            {wallet ? <Money value={wallet.balance} currency={wallet.currency} /> : '…'}
          </div>
          <div className="text-xs text-muted mt-1">
            {wallet?.billing_mode === 'postpay'
              ? `Postpay · credit limit ${wallet.credit_limit} ${wallet.currency}`
              : 'Prepay · top up before sending'}
          </div>
          <form onSubmit={requestTopup} className="mt-4 space-y-2.5">
            <div className="card-title !text-sm">Request a top-up</div>
            <div className="flex gap-2">
              <input className="input font-mono" value={amount}
                onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" />
              <button className="btn shrink-0" type="submit" disabled={busy}>
                {busy ? '…' : 'Request'}
              </button>
            </div>
            <input className="input" value={note}
              onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. bank ref) — optional" maxLength={500} />
          </form>
          {!!topups.length && (
            <div className="mt-3 space-y-1.5">
              {topups.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono">{Number(t.amount).toFixed(2)}</span>
                  <StatusBadge status={t.status === 'approved' ? 'delivered' : t.status === 'rejected' ? 'failed' : 'submitted'} />
                  <span className="text-muted ml-auto">{new Date(t.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card card-pad">
          <div className="card-title !text-sm">Sender IDs</div>
          <div className="card-sub">Only approved IDs can be used in From</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {senders.map((s) => (
              <span key={s.sender} className={`badge border font-mono ${s.status === 'approved'
                ? 'bg-brand/10 text-emerald-300 border-brand/25'
                : 'bg-warn/10 text-amber-300 border-warn/25'}`}>
                {s.sender}
              </span>
            ))}
            {!senders.length && <span className="text-xs text-muted">None yet — request one below.</span>}
          </div>
          <form onSubmit={requestSender} className="mt-4 space-y-2.5">
            <div className="card-title !text-sm">Request a sender ID</div>
            <div className="flex gap-2">
              <input className="input font-mono" value={sender}
                onChange={(e) => setSender(e.target.value)} maxLength={21} placeholder="e.g. MYBRAND" />
              <button className="btn shrink-0" type="submit" disabled={busy || !sender}>
                {busy ? '…' : 'Request'}
              </button>
            </div>
          </form>
          {!!senderReqs.length && (
            <div className="mt-3 space-y-1.5">
              {senderReqs.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono">{t.sender}</span>
                  <StatusBadge status={t.status === 'approved' ? 'delivered' : t.status === 'rejected' ? 'failed' : 'submitted'} />
                  <span className="text-muted ml-auto">{new Date(t.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="card-title mb-2 px-1">
          Ledger <span className="text-muted font-normal">· top-ups & adjustments only — per-SMS cost is in your reports</span>
        </div>
        <DataTable
          keyOf={(_, i) => String(i)}
          rows={txs}
          empty="No transactions yet."
          columns={[
            {
              key: 'created_at', label: 'Time',
              render: (t) => <span className="text-xs text-muted whitespace-nowrap">{new Date(String(t.created_at)).toLocaleString()}</span>,
            },
            { key: 'type', label: 'Type', render: (t) => <StatusBadge status={String(t.type)} /> },
            { key: 'amount', label: 'Amount', right: true, render: (t) => <Money value={t.amount} tone /> },
            { key: 'balance_after', label: 'Balance after', right: true, render: (t) => <Money value={t.balance_after} /> },
            {
              key: 'remark', label: 'Remark',
              render: (t) => <span className="text-xs max-w-[260px] block truncate" title={String(t.remark ?? t.description ?? '')}>{String(t.remark ?? t.description ?? '—')}</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}
