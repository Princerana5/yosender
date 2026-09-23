import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, API_BASE, token } from '../api';
import { PageHeader, StatusBadge, StatCard, Modal } from '../components';

interface RnClient {
  id: string; name: string; company_name: string | null;
  account_id: string; system_id: string; email: string | null;
  portal_email: string | null; rate_email: string | null; status: string;
}

interface Country { name: string; iso_code: string; calling_code: string; mccs: string[]; }

interface Contact {
  id: string; display_name: string; email: string;
  is_default_cc: boolean; is_default_bcc: boolean; last_used_at: string | null;
}

const BILLING_MODES = [
  { v: 'on_submission', label: 'On Submission', help: 'Client is charged when the message is submitted to 8xtel.' },
  { v: 'on_delivery', label: 'On Delivery Only', help: 'Client is charged only after a successful delivery confirmation.' },
  { v: 'submission_delivery', label: 'Submission + Delivery', help: 'Split charge: one part on submission, the rest on delivery.' },
  { v: 'operator_submission', label: 'Operator Submission', help: 'Charged when the operator accepts the submission.' },
  { v: 'operator_delivery', label: 'Operator Delivery', help: 'Charged when the operator confirms delivery.' },
  { v: 'hybrid', label: 'Hybrid: Submission + Operator Delivery', help: 'Submission charge plus operator delivery charge.' },
  { v: 'on_attempt', label: 'On Attempt', help: 'Charged on every routing attempt, even if retried.' },
  { v: 'on_accepted', label: 'On Accepted', help: 'Charged when 8xtel accepts the message for processing.' },
] as const;

type BillingModeV = (typeof BILLING_MODES)[number]['v'];

function bmLabel(v: string): string {
  return BILLING_MODES.find((b) => b.v === v)?.label ?? 'On Submission';
}
function bmHelp(v: string): string {
  return BILLING_MODES.find((b) => b.v === v)?.help ?? '';
}
const BM_PILL: Record<string, string> = {
  on_submission: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  on_delivery: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  submission_delivery: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
  operator_submission: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  operator_delivery: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  hybrid: 'bg-pink-500/15 text-pink-300 border-pink-500/25',
  on_attempt: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  on_accepted: 'bg-teal-500/15 text-teal-300 border-teal-500/25',
};
function BmPill({ mode }: { mode: string }): JSX.Element {
  return (
    <span className={'badge border ' + (BM_PILL[mode] ?? BM_PILL.on_submission)} title={bmHelp(mode)}>
      {bmLabel(mode)}
    </span>
  );
}

interface Dest {
  country: string; country_code: string;
  network_name: string; mcc: string; mncMode: 'all' | 'specific'; mnc: string;
  currency: 'EUR' | 'USD'; rate: string;
  billing_mode: BillingModeV; delivery_rate: string;
}

interface SavedRate {
  id: string; country: string; country_code: string | null; network_name: string;
  mcc: string; mnc: string; currency: string; rate: string;
  billing_mode: string; delivery_rate: string | null; updated_at: string;
}

interface Preview {
  to: string; cc: string[]; bcc: string[];
  from: string; from_name: string; subject: string;
  valid_from_display: string; html: string;
  attachment: {
    filename: string; route_count: number; countries: number; networks: number;
    currency: string; empty: boolean; error?: string;
  } | null;
}

interface AttachSample {
  filename: string; route_count: number; countries: number; networks: number;
  currency: string; empty: boolean;
  sample: Array<{ country: string; operator: string; mcc: string; mnc: string; rate: number; currency: string; time: string }>;
}

interface RnRow {
  id: string; client_name: string; account_id: string; system_id: string;
  recipient_email: string; subject: string; valid_from: string; status: string;
  created_by_email: string | null; created_at: string; sent_at: string | null;
  dest_count: string; currencies: string[] | null; billing_modes: string[] | null;
  to_list: string[] | null; cc_list: string[] | null; bcc_list: string[] | null;
  attachment_filename: string | null; attachment_routes: number | null;
}

const emptyDest = (): Dest => ({
  country: '', country_code: '', network_name: '',
  mcc: '', mncMode: 'all', mnc: 'ALL', currency: 'EUR', rate: '',
  billing_mode: 'on_submission', delivery_rate: '',
});

function toLocalInput(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDT(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function rnShortId(id: string): string {
  return `RN-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

interface ToastMsg { id: number; ok: boolean; text: string; }
let toastSeq = 1;
export function useToasts(): { toasts: ToastMsg[]; push: (ok: boolean, text: string) => void } {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  function push(ok: boolean, text: string): void {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, ok, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }
  return { toasts, push };
}
export function Toasts({ toasts }: { toasts: ToastMsg[] }): JSX.Element {
  return (
    <div className="fixed bottom-5 right-5 z-[60] space-y-2 w-80">
      {toasts.map((t) => (
        <div key={t.id} className={`card card-pad !py-3 !px-4 text-sm flex items-start gap-2 border-l-4 ${t.ok ? '!border-l-emerald-500' : '!border-l-red-500'}`}>
          <span className={t.ok ? 'text-emerald-400' : 'text-red-400'}>{t.ok ? '✓' : '✕'}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

const EMPTY_FILTERS = { search: '', from: '', to: '', client: '', account_id: '', system_id: '', status: '', currency: '', billing_mode: '', country: '', sent_by: '' };

export function RateNotificationHistory(): JSX.Element {
  const [rows, setRows] = useState<RnRow[]>([]);
  const [stats, setStats] = useState({ total: 0, sent: 0, failed: 0, drafts: 0, month: 0 });
  const [f, setF] = useState({ ...EMPTY_FILTERS });
  const [applied, setApplied] = useState({ ...EMPTY_FILTERS });
  const [loading, setLoading] = useState(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [recipFor, setRecipFor] = useState<RnRow | null>(null);
  const { toasts, push } = useToasts();

  function load(filters = applied): void {
    setLoading(true);
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    api<{ notifications: RnRow[] }>(`/rate-notifications${qs ? `?${qs}` : ''}`)
      .then((r) => setRows(r.notifications))
      .catch((e) => push(false, `Load failed: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); api<{ total: number; sent: number; failed: number; drafts: number; month: number }>('/rate-notifications/stats').then(setStats).catch(() => undefined); }, []);

  function doExport(format: 'csv' | 'xls'): void {
    const qs = new URLSearchParams({ ...applied, format }).toString();
    const a = document.createElement('a');
    a.href = `${API_BASE}/rate-notifications/export?${qs}`;
    const t = token();
    void (async () => {
      const res = await fetch(a.href, { headers: t ? { authorization: `Bearer ${t}` } : {} });
      if (!res.ok) { push(false, 'Export failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = `rate-notifications.${format}`; a.click();
      URL.revokeObjectURL(url);
      push(true, `Exported ${rows.length} notification(s)`);
    })();
  }

  function downloadXlsx(id: string, filename: string): void {
    const t = token();
    void (async () => {
      const res = await fetch(`${API_BASE}/rate-notifications/${id}/attachment`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
      if (!res.ok) { push(false, 'Download failed — no attachment stored'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      push(true, 'Excel downloaded ✓');
    })();
  }

  async function act(id: string, action: 'resend' | 'resend-new' | 'copy' | 'delete', filename?: string | null): Promise<void> {
    setMenuFor(null);
    try {
      if (action === 'delete') {
        if (!window.confirm('Delete this notification and its history?')) return;
        await api(`/rate-notifications/${id}`, { method: 'DELETE' });
        push(true, 'Notification deleted');
      } else if (action === 'copy') {
        const r = await api<{ id: string }>('/rate-notifications/' + id + '/copy', { method: 'POST' });
        push(true, 'Notification copied as draft');
        window.location.href = `/rate-notifications/${r.id}`;
        return;
      } else if (action === 'resend-new') {
        if (!window.confirm('Regenerate the Excel from current active rates and resend?')) return;
        await api(`/rate-notifications/${id}/resend?mode=regenerate`, { method: 'POST' });
        push(true, 'Notification resent with fresh rates ✓');
      } else {
        await api(`/rate-notifications/${id}/resend`, { method: 'POST' });
        push(true, 'Notification resent with original attachment ✓');
      }
      load();
    } catch (e) { push(false, `${action} failed: ${(e as Error).message}`); }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Rate Notifications"
        sub="Manage, create, send and track client rate notifications."
        actions={<><Link className="btn-ghost" to="/rate-notifications/contacts">Saved Contacts</Link><Link className="btn" to="/rate-notifications/new">+ Create Rate Notification</Link></>}
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 my-4">
        <StatCard label="Total Notifications" value={stats.total.toLocaleString()} />
        <StatCard label="Sent" value={stats.sent.toLocaleString()} tone="brand" />
        <StatCard label="Failed" value={stats.failed.toLocaleString()} tone="danger" />
        <StatCard label="Drafts" value={stats.drafts.toLocaleString()} tone="warn" />
        <StatCard label="This Month" value={stats.month.toLocaleString()} tone="accent" />
      </div>

      <div className="card card-pad mb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="col-span-2"><label className="label">Search Rate Notifications</label><input className="input" placeholder="Client, account, system ID, subject…" value={f.search} onChange={set('search')} onKeyDown={(e) => e.key === 'Enter' && (setApplied({ ...f }), load({ ...f }))} /></div>
          <div><label className="label">From</label><input type="date" className="input" value={f.from} onChange={set('from')} /></div>
          <div><label className="label">To</label><input type="date" className="input" value={f.to} onChange={set('to')} /></div>
          <div><label className="label">Client</label><input className="input" value={f.client} onChange={set('client')} /></div>
          <div><label className="label">Account ID</label><input className="input mono" value={f.account_id} onChange={set('account_id')} /></div>
          <div><label className="label">System ID</label><input className="input mono" value={f.system_id} onChange={set('system_id')} /></div>
          <div><label className="label">Status</label><select className="input" value={f.status} onChange={set('status')}><option value="">All</option><option value="sent">Sent</option><option value="sending">Sending</option><option value="failed">Failed</option><option value="draft">Draft</option></select></div>
          <div><label className="label">Currency</label><select className="input" value={f.currency} onChange={set('currency')}><option value="">All</option><option value="EUR">EUR</option><option value="USD">USD</option></select></div>
          <div><label className="label">Billing Mode</label><select className="input" value={f.billing_mode} onChange={set('billing_mode')}><option value="">All</option>{BILLING_MODES.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}</select></div>
          <div><label className="label">Country</label><input className="input" value={f.country} onChange={set('country')} /></div>
          <div><label className="label">Sent By</label><input className="input" value={f.sent_by} onChange={set('sent_by')} /></div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button className="btn !py-1.5 !text-xs" onClick={() => { setApplied({ ...f }); load({ ...f }); }}>Search</button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => { setF({ ...EMPTY_FILTERS }); setApplied({ ...EMPTY_FILTERS }); load({ ...EMPTY_FILTERS }); }}>Clear Filters</button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => doExport('csv')}>Export CSV</button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => doExport('xls')}>Export Excel</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>
              <th>Date</th><th>Client</th><th>Account ID</th><th>System ID</th>
              <th>Recipients</th><th>Destinations</th><th>Currency</th><th>Billing Mode</th>
              <th>Status</th><th>Sent By</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={11} className="text-center text-muted py-8">Loading rate notifications…</td></tr>}
              {!loading && rows.map((r) => {
                const to = r.to_list ?? (r.recipient_email ? [r.recipient_email] : []);
                const cc = r.cc_list ?? [];
                const bcc = r.bcc_list ?? [];
                const total = to.length + cc.length + bcc.length;
                return (
                  <tr key={r.id}>
                    <td className="text-xs whitespace-nowrap">{fmtDT(r.created_at)}</td>
                    <td><Link className="link font-medium" to={`/rate-notifications/${r.id}`}>{r.client_name}</Link><div className="text-[10px] text-muted mono">{rnShortId(r.id)}</div></td>
                    <td className="mono text-xs">{r.account_id}</td>
                    <td className="mono text-xs">{r.system_id}</td>
                    <td><button className="badge border border-line bg-panel2 hover:border-brand/60" title="View recipients" onClick={() => setRecipFor(r)}>{total} Recipient{total === 1 ? '' : 's'}</button>
                      {r.attachment_filename && <div className="text-[10px] text-emerald-300 mt-0.5" title={`${r.attachment_filename} · ${r.attachment_routes ?? 0} routes`}>✓ Excel attached</div>}</td>
                    <td className="text-center tabular-nums">{r.dest_count}</td>
                    <td className="text-xs">{(r.currencies ?? []).join(' / ') || '—'}</td>
                    <td className="text-xs">{(r.billing_modes ?? []).map((m) => bmLabel(m)).join(', ') || '—'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-xs">{r.created_by_email ?? '—'}</td>
                    <td className="whitespace-nowrap">
                      <Link className="link text-xs mr-2" to={`/rate-notifications/${r.id}`}>View</Link>
                      <span className="relative">
                        <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}>⋯</button>
                        {menuFor === r.id && (
                          <div className="absolute right-0 z-30 card !rounded-lg py-1 w-40 shadow-card">
                            <Link className="block px-3 py-1.5 text-xs hover:bg-panel2" to={`/rate-notifications/${r.id}`}>View</Link>
                            <Link className="block px-3 py-1.5 text-xs hover:bg-panel2" to={`/rate-notifications/${r.id}?tab=email`}>View Email</Link>
                            <button className="block w-full text-left px-3 py-1.5 text-xs hover:bg-panel2" onClick={() => void act(r.id, 'resend')}>Resend Original Attachment</button>
                            <button className="block w-full text-left px-3 py-1.5 text-xs hover:bg-panel2" onClick={() => void act(r.id, 'resend-new')}>Generate New Rate File</button>
                            <button className="block w-full text-left px-3 py-1.5 text-xs hover:bg-panel2" onClick={() => void act(r.id, 'copy')}>Copy Notification</button>
                            {r.attachment_filename && <button className="block w-full text-left px-3 py-1.5 text-xs hover:bg-panel2" onClick={() => downloadXlsx(r.id, r.attachment_filename!)}>Download Excel</button>}
                            <button className="block w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-panel2" onClick={() => void act(r.id, 'delete')}>Delete</button>
                          </div>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!loading && !rows.length && (
                <tr><td colSpan={11} className="text-center py-10">
                  <div className="font-semibold">{Object.values(applied).some(Boolean) ? 'No matching notifications found.' : 'No Rate Notifications Yet'}</div>
                  <div className="text-xs text-muted mt-1">{Object.values(applied).some(Boolean) ? 'Try adjusting your filters.' : 'Create your first rate notification to start managing client rate updates.'}</div>
                  <div className="mt-3 flex gap-2 justify-center">
                    {Object.values(applied).some(Boolean)
                      ? <button className="btn-ghost !text-xs" onClick={() => { setF({ ...EMPTY_FILTERS }); setApplied({ ...EMPTY_FILTERS }); load({ ...EMPTY_FILTERS }); }}>Clear Filters</button>
                      : <Link className="btn !text-xs" to="/rate-notifications/new">+ Create Rate Notification</Link>}
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {recipFor && (
        <Modal title={`Recipients — ${recipFor.client_name}`} onClose={() => setRecipFor(null)}>
          <div className="text-xs space-y-2">
            <div><span className="label">TO</span><div className="mono break-all">{(recipFor.to_list ?? [recipFor.recipient_email]).join(', ')}</div></div>
            {!!(recipFor.cc_list ?? []).length && <div><span className="label">CC</span><div className="mono break-all">{recipFor.cc_list!.join(', ')}</div></div>}
            {!!(recipFor.bcc_list ?? []).length && <div><span className="label">BCC (admin only)</span><div className="mono break-all">{recipFor.bcc_list!.join(', ')}</div></div>}
          </div>
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

export function RateNotificationDetail(): JSX.Element {
  const { id } = useParams();
  const [data, setData] = useState<{ notification: Record<string, string | null>; rates: Array<Record<string, string>>; recipients: { to: string[]; cc: string[]; bcc: string[] }; attachment: { filename: string; route_count: number; country_count: number; network_count: number; currency: string | null } | null; html: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { toasts, push } = useToasts();
  const load = (): void => {
    api<{ notification: Record<string, string | null>; rates: Array<Record<string, string>>; recipients: { to: string[]; cc: string[]; bcc: string[] }; attachment: { filename: string; route_count: number; country_count: number; network_count: number; currency: string | null } | null; html: string }>(`/rate-notifications/${id}`)
      .then((d) => { setData(d); if (new URLSearchParams(window.location.search).get('tab') === 'email') setShowEmail(true); })
      .catch((e) => setMsg(`Load failed: ${(e as Error).message}`));
  };
  useEffect(load, [id]);
  async function resend(mode: 'original' | 'regenerate'): Promise<void> {
    setBusy(true); setMsg('');
    try {
      await api(`/rate-notifications/${id}/resend${mode === 'regenerate' ? '?mode=regenerate' : ''}`, { method: 'POST' });
      push(true, mode === 'regenerate' ? 'Notification resent with fresh rates ✓' : 'Notification resent with original attachment ✓'); load();
    } catch (e) { push(false, `Resend failed: ${(e as Error).message}`); }
    setBusy(false);
  }
  function downloadXlsx(): void {
    if (!data?.attachment || !id) return;
    const t = token();
    void (async () => {
      const res = await fetch(`${API_BASE}/rate-notifications/${id}/attachment`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
      if (!res.ok) { push(false, 'Download failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = data.attachment!.filename; a.click();
      URL.revokeObjectURL(url);
      push(true, 'Excel downloaded ✓');
    })();
  }
  async function copyNotif(): Promise<void> {
    try {
      const r = await api<{ id: string }>(`/rate-notifications/${id}/copy`, { method: 'POST' });
      push(true, 'Notification copied as draft');
      window.location.href = `/rate-notifications/${r.id}`;
    } catch (e) { push(false, `Copy failed: ${(e as Error).message}`); }
  }
  if (!data) return <div><PageHeader title="Rate Notification" sub="" /><p className="text-muted">{msg || 'Loading…'}</p></div>;
  const n = data.notification;
  const rec = data.recipients ?? { to: [String(n.recipient_email ?? '')], cc: [], bcc: [] };
  const totalRec = rec.to.length + rec.cc.length + rec.bcc.length;
  return (
    <div>
      <PageHeader
        title="Rate Notification"
        sub={String(n.subject ?? '')}
        actions={<>
          <Link className="btn-ghost" to="/rate-notifications">← History</Link>
          <button className="btn-ghost" onClick={() => setShowEmail((v) => !v)}>View Email</button>
          <button className="btn-ghost" onClick={() => setDrawer(true)}>Details</button>
          {data.attachment && <button className="btn-ghost" onClick={() => downloadXlsx()}>Download Excel</button>}
          <button className="btn-ghost" onClick={() => void copyNotif()}>Copy</button>
          <button className="btn-ghost" onClick={() => void resend('original')} disabled={busy}>Resend Original</button>
          <button className="btn" onClick={() => void resend('regenerate')} disabled={busy}>{busy ? 'Sending…' : 'Resend New File'}</button>
        </>}
      />
      {msg && <div className="card card-pad mb-3 text-sm">{msg}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        <div className="card card-pad"><div className="label">Status</div><StatusBadge status={String(n.status ?? '')} /></div>
        <div className="card card-pad"><div className="label">Notification ID</div><div className="mono text-sm">{id ? rnShortId(id) : '—'}</div></div>
        <div className="card card-pad"><div className="label">Recipients</div><div className="text-sm font-semibold">{totalRec}</div></div>
        <div className="card card-pad"><div className="label">Destinations</div><div className="text-sm font-semibold">{data.rates.length}</div></div>
      </div>
      <div className="card card-pad mb-3">
        <div className="card-title mb-2">Rate Information</div>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Country</th><th>Network</th><th>MCC</th><th>MNC</th><th>Currency</th><th className="!text-right">Rate</th><th>Billing Mode</th><th>Valid From</th></tr></thead>
          <tbody>{data.rates.map((r, i) => (
            <tr key={i}>
              <td className="font-medium">{r.country}</td><td>{r.network_name}</td>
              <td className="text-center mono">{r.mcc}</td><td className="text-center mono">{r.mnc}</td>
              <td>{r.currency}</td>
              <td className="!text-right mono">{Number(r.rate).toFixed(3)}{r.delivery_rate ? ` +${Number(r.delivery_rate).toFixed(3)}` : ''}</td>
              <td><BmPill mode={r.billing_mode ?? 'on_submission'} /></td>
              <td className="text-xs whitespace-nowrap">{fmtDT(String(n.valid_from ?? ''))}</td>
            </tr>
          ))}</tbody></table></div>
      </div>
      {n.error_message && <div className="card card-pad mb-3 text-sm text-red-300">Error: {n.error_message}</div>}
      {data.attachment && (
        <div className="card card-pad mb-3">
          <div className="card-title mb-1">Attachment</div>
          <div className="text-sm">✓ Excel attached</div>
          <div className="text-xs text-muted mono break-all">Filename: {data.attachment.filename}</div>
          <div className="text-xs text-muted">Active Routes: {data.attachment.route_count} · Countries: {data.attachment.country_count} · Networks: {data.attachment.network_count} · Currency: {data.attachment.currency ?? '—'}</div>
          <div className="flex gap-2 mt-2">
            <button className="btn-ghost !text-xs" onClick={() => downloadXlsx()}>Download Excel</button>
          </div>
        </div>
      )}
      {showEmail && (
        <div className="card card-pad mb-3">
          <div className="card-title mb-2">Email Preview</div>
          <div className="text-xs mb-2 space-y-0.5 rounded-lg bg-panel2/60 border border-line/60 p-3">
            <div><span className="text-muted">From: </span>8xtel Rate Notification &lt;<span className="mono">rates@8xtel.com</span>&gt;</div>
            <div><span className="text-muted">To: </span><span className="mono">{rec.to.join(', ')}</span></div>
            {!!rec.cc.length && <div><span className="text-muted">CC: </span><span className="mono">{rec.cc.join(', ')}</span></div>}
            <div><span className="text-muted">Subject: </span><span className="mono">{String(n.subject ?? '')}</span></div>
            <div className="text-muted italic">BCC is never shown in the client-facing preview.</div>
          </div>
          <iframe title="email" className="w-full rounded-lg border border-line bg-white" style={{ height: 560 }} srcDoc={data.html} />
        </div>
      )}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg bg-panel border-l border-line h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div><div className="text-[11px] uppercase tracking-wider text-muted">Rate Notification</div><div className="font-bold text-lg">Details</div></div>
              <button className="btn-ghost !px-2 !py-1" onClick={() => setDrawer(false)}>✕</button>
            </div>
            <div className="space-y-4 text-sm">
              <section><div className="label">Status</div><StatusBadge status={String(n.status ?? '')} /><div className="mt-1 text-xs text-muted">ID: <span className="mono">{id ? rnShortId(id) : ''}</span></div><div className="text-xs text-muted">Created: {fmtDT(String(n.created_at ?? ''))}</div><div className="text-xs text-muted">Sent: {fmtDT(String(n.sent_at ?? ''))}</div></section>
              <section><div className="label">Client</div><div className="font-semibold">{String(n.client_name ?? '')}</div><div className="text-xs text-muted">Account ID: <span className="mono">{String(n.account_id ?? '')}</span></div><div className="text-xs text-muted">System ID: <span className="mono">{String(n.system_id ?? '')}</span></div></section>
              <section><div className="label">Email</div><div className="text-xs">From: <span className="mono">rates@8xtel.com</span></div><div className="text-xs">TO: <span className="mono break-all">{rec.to.join(', ')}</span></div>{!!rec.cc.length && <div className="text-xs">CC: <span className="mono break-all">{rec.cc.join(', ')}</span></div>}{!!rec.bcc.length && <div className="text-xs">BCC (admin only): <span className="mono break-all">{rec.bcc.join(', ')}</span></div>}<div className="text-xs">Subject: <span className="mono break-all">{String(n.subject ?? '')}</span></div></section>
              <section><div className="label">Delivery Information</div><div className="text-xs">Status: {String(n.status ?? '')}</div><div className="text-xs">Sent At: {fmtDT(String(n.sent_at ?? ''))}</div><div className="text-xs">Sent By: {String(n.created_by_email ?? '—')}</div>{n.error_message && <div className="text-xs text-red-300">Error: {String(n.error_message)}</div>}</section>
            </div>
          </div>
        </div>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

function RecipientPicker({ label, values, onChange, exclude }: {
  label: string; values: string[]; onChange: (v: string[]) => void; exclude: string[];
}): JSX.Element {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api<{ contacts: Contact[] }>(`/rate-notifications/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then((r) => setOpts(r.contacts)).catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);
  const lower = new Set([...values, ...exclude].map((e) => e.toLowerCase()));
  function add(email: string): void {
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v) || lower.has(v)) return;
    onChange([...values, v]);
    setQ(''); setDraftName(''); setOpen(false);
  }
  const showAddNew = q.trim() && EMAIL_RE.test(q.trim()) && !lower.has(q.trim().toLowerCase());
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {values.map((e) => (
          <span key={e} className="badge border border-line bg-panel2 !text-xs !py-1 !px-2.5">
            <span className="mono">{e}</span>
            <button className="ml-1.5 text-muted hover:text-red-300" title="Remove from this notification (saved contact is kept)" onClick={() => onChange(values.filter((x) => x !== e))}>✕</button>
          </span>
        ))}
        {!values.length && <span className="text-xs text-muted">None — click + Add to include recipients.</span>}
      </div>
      <div className="relative">
        <div className="flex gap-2">
          <input
            className="input mono !text-xs" placeholder="Search saved contacts or type an email…"
            value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(q); } if (e.key === 'Escape') setOpen(false); }}
          />
          <button className="btn-ghost !text-xs whitespace-nowrap" onClick={() => setOpen((v) => !v)}>+ Add</button>
        </div>
        {open && (
          <div className="absolute z-30 mt-1 w-full card !rounded-lg max-h-56 overflow-y-auto py-1 shadow-card">
            {opts.filter((c) => !lower.has(c.email.toLowerCase())).map((c) => (
              <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-panel2" onClick={() => add(c.email)}>
                <div className="text-xs font-semibold">{c.display_name}</div>
                <div className="text-[11px] text-muted mono">{c.email}</div>
              </button>
            ))}
            {showAddNew && (
              <div className="px-3 py-2 border-t border-line/60">
                <div className="text-[11px] text-muted mb-1">New address — saved automatically as a contact:</div>
                <input className="input !text-xs mb-1.5" placeholder="Display name (optional)" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                <button
                  className="btn !text-xs !py-1.5 w-full"
                  onClick={() => {
                    const email = q.trim().toLowerCase();
                    const name = draftName.trim() || email.split('@')[0]!.replace(/[._-]+/g, ' ');
                    api('/rate-notifications/contacts', { method: 'POST', body: JSON.stringify({ display_name: name, email }) }).catch(() => undefined);
                    add(email);
                  }}
                >Add {q.trim().toLowerCase()}</button>
              </div>
            )}
            {!opts.length && !showAddNew && <div className="px-3 py-2 text-xs text-muted">No saved contacts yet — type an email to add one.</div>}
            <button className="w-full text-center text-[11px] text-muted py-1.5 hover:text-gray-200" onClick={() => setOpen(false)}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function RateNotificationCreate(): JSX.Element {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<RnClient[]>([]);
  const [client, setClient] = useState<RnClient | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [dests, setDests] = useState<Dest[]>([emptyDest()]);
  const [validFrom, setValidFrom] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState(1);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [result, setResult] = useState<{ ok: boolean; id?: string; error?: string; recipient_count?: number; dest_count?: number } | null>(null);
  const [includeAttachment, setIncludeAttachment] = useState(true);
  const [attachSample, setAttachSample] = useState<AttachSample | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const { toasts, push } = useToasts();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedRate[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [manageRates, setManageRates] = useState(false);

  function toDest(r: SavedRate): Dest {
    const all = r.mnc.toUpperCase() === 'ALL';
    const bm = (BILLING_MODES.some((b) => b.v === r.billing_mode) ? r.billing_mode : 'on_submission') as BillingModeV;
    return {
      country: r.country, country_code: r.country_code ?? '',
      network_name: r.network_name, mcc: r.mcc,
      mncMode: all ? 'all' : 'specific', mnc: all ? 'ALL' : r.mnc,
      currency: (r.currency === 'USD' ? 'USD' : 'EUR'), rate: String(r.rate),
      billing_mode: bm, delivery_rate: r.delivery_rate ?? '',
    };
  }

  const [rateEmailDraft, setRateEmailDraft] = useState('');

  async function saveRateEmail(): Promise<void> {
    if (!client) return;
    const v = rateEmailDraft.trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setMsg('Rates email is not a valid email address.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await api<{ rate_email: string | null }>(`/rate-notifications/clients/${client.id}/rate-email`, {
        method: 'PATCH', body: JSON.stringify({ rate_email: v || null }),
      });
      const eff = r.rate_email ?? client.portal_email;
      setClient({ ...client, rate_email: r.rate_email, email: eff });
      setRateEmailDraft('');
      setMsg(v ? `Rates email set to ${r.rate_email} ✓` : 'Rates email cleared — portal email will be used.');
    } catch (e) { setMsg(`Save failed: ${(e as Error).message}`); }
    setBusy(false);
  }

  function pickClient(c: RnClient): void {
    setClient(c); setPreview(null); setSaved([]); setSavedLoaded(false);
    setRateEmailDraft(c.rate_email ?? '');
    setCc([]); setBcc([]);
    api<{ default_cc: Contact[]; default_bcc: Contact[] }>('/rate-notifications/contacts/defaults')
      .then((r) => {
        const to = (c.rate_email ?? c.portal_email ?? '').toLowerCase();
        setCc(r.default_cc.map((x) => x.email.toLowerCase()).filter((e) => e !== to));
        setBcc(r.default_bcc.map((x) => x.email.toLowerCase()).filter((e) => e !== to));
      }).catch(() => undefined);
    api<{ rates: SavedRate[] }>(`/rate-notifications/saved-rates/${c.id}`)
      .then((r) => {
        setSaved(r.rates); setSavedLoaded(true);
        if (r.rates.length) setDests(r.rates.map(toDest));
      })
      .catch(() => setSavedLoaded(true));
  }

  async function saveRate(i: number): Promise<void> {
    if (!client) return;
    const d = dests[i];
    const mnc = d.mncMode === 'all' ? 'ALL' : d.mnc.trim().toUpperCase();
    const split = d.billing_mode === 'submission_delivery' || d.billing_mode === 'hybrid';
    const dr = split ? Number(d.delivery_rate) : NaN;
    if (split && (!Number.isFinite(dr) || dr <= 0)) { setMsg(`Destination ${i + 1}: ${bmLabel(d.billing_mode)} needs a delivery rate.`); return; }
    setBusy(true); setMsg('');
    try {
      await api(`/rate-notifications/saved-rates/${client.id}`, {
        method: 'POST',
        body: JSON.stringify({
          country: d.country, country_code: d.country_code || null,
          network_name: d.network_name.trim(), mcc: d.mcc, mnc,
          currency: d.currency, rate: Number(d.rate),
          billing_mode: d.billing_mode, delivery_rate: split ? dr : null,
        }),
      });
      const r = await api<{ rates: SavedRate[] }>(`/rate-notifications/saved-rates/${client.id}`);
      setSaved(r.rates);
      setMsg(`Rate saved for ${d.country} — it will prefill next time ✓`);
    } catch (e) { setMsg(`Save failed: ${(e as Error).message}`); }
    setBusy(false);
  }

  async function deleteSaved(id: string): Promise<void> {
    if (!client || !window.confirm('Remove this saved rate?')) return;
    try {
      await api(`/rate-notifications/saved-rates/${client.id}/${id}`, { method: 'DELETE' });
      setSaved((s) => s.filter((r) => r.id !== id));
    } catch (e) { setMsg(`Remove failed: ${(e as Error).message}`); }
  }

  useEffect(() => {
    api<{ countries: Country[] }>('/rate-notifications/countries').then((r) => setCountries(r.countries)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ clients: RnClient[] }>(`/rate-notifications/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then((r) => setOpts(r.clients)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function setDest(i: number, patch: Partial<Dest>): void {
    setDests((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }
  function pickCountry(i: number, name: string): void {
    const c = countries.find((x) => x.name === name);
    // MCC = ITU E.212 mobile country code (e.g. India 404, USA 310,
    // Singapore 525) — NEVER the dialling/calling code (91/1/65).
    setDest(i, {
      country: name, country_code: c?.iso_code ?? '',
      network_name: `${name} - Default`, mcc: c?.mccs?.[0] ?? '',
    });
  }

  const [formError, setFormError] = useState('');

  function payload(): { client_id: string; valid_from: string; timezone: string; cc: string[]; bcc: string[]; include_attachment: boolean; rates: unknown[] } | null {
    const fail = (m: string): null => { setFormError(m); return null; };
    if (!client) return fail('Select a client first.');
    if (!client.email) return fail('Selected client has no email on file — set "Send mail to" in section 1.');
    const rates: unknown[] = [];
    for (let i = 0; i < dests.length; i++) {
      const d = dests[i];
      if (!d.country) return fail(`Destination ${i + 1}: select a country.`);
      if (!d.network_name.trim()) return fail(`Destination ${i + 1}: enter a network name.`);
      if (!/^\d{3}$/.test(d.mcc)) return fail(`Destination ${i + 1}: MCC must be 3 digits.`);
      const mnc = d.mncMode === 'all' ? 'ALL' : d.mnc.trim().toUpperCase();
      if (!/^(\d{1,3}|ALL)$/.test(mnc)) return fail(`Destination ${i + 1}: MNC must be digits or ALL.`);
      const rate = Number(d.rate);
      if (!Number.isFinite(rate) || rate <= 0) return fail(`Destination ${i + 1}: rate must be a positive number.`);
      const split = d.billing_mode === 'submission_delivery' || d.billing_mode === 'hybrid';
      const dr = split ? Number(d.delivery_rate) : NaN;
      if (split && (!Number.isFinite(dr) || dr <= 0)) return fail(`Destination ${i + 1}: ${bmLabel(d.billing_mode)} needs a delivery rate.`);
      rates.push({
        country: d.country, country_code: d.country_code || null,
        network_name: d.network_name.trim(), mcc: d.mcc, mnc,
        currency: d.currency, rate,
        billing_mode: d.billing_mode, delivery_rate: split ? dr : null,
      });
    }
    const vf = new Date(validFrom);
    if (Number.isNaN(vf.getTime())) return fail('Valid From is invalid.');
    const to = (client.email ?? '').toLowerCase();
    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    for (const e of cc) {
      if (!EMAIL_RE.test(e)) return fail(`CC address is invalid: ${e}`);
      if (e.toLowerCase() === to) return fail(`TO email must not appear in CC: ${e}`);
    }
    for (const e of bcc) {
      if (!EMAIL_RE.test(e)) return fail(`BCC address is invalid: ${e}`);
      if (e.toLowerCase() === to) return fail(`TO email must not appear in BCC: ${e}`);
    }
    const ccSet = new Set(cc.map((e) => e.toLowerCase()));
    for (const e of bcc) {
      if (ccSet.has(e.toLowerCase())) return fail(`Email must not be in both CC and BCC: ${e}`);
    }
    setFormError('');
    return { client_id: client.id, valid_from: vf.toISOString(), timezone: 'GMT', cc, bcc, include_attachment: includeAttachment, rates };
  }

  async function loadAttachSample(): Promise<void> {
    if (!client) return;
    setAttachLoading(true);
    try {
      const r = await api<AttachSample>(`/rate-notifications/attachment-preview/${client.id}?account_id=${encodeURIComponent(client.account_id)}&system_id=${encodeURIComponent(client.system_id)}`);
      setAttachSample(r);
      if (r.empty) setMsg('No active rates found for this client account. Verify the route/rate configuration before sending.');
    } catch (e) { setMsg(`Attachment preview failed: ${(e as Error).message}`); }
    setAttachLoading(false);
  }

  async function doPreview(): Promise<void> {
    const p = payload();
    if (!p) return;
    setBusy(true); setMsg('');
    try {
      setPreview(await api<Preview>('/rate-notifications/preview', { method: 'POST', body: JSON.stringify(p) }));
    } catch (e) { setMsg(`Preview failed: ${(e as Error).message}`); }
    setBusy(false);
  }

  // Send button: validate → fetch a fresh preview → open the confirm popup.
  // (Previously it required a preview to exist first, which made the button
  // look dead when clicked before Preview Email.)
  async function doPreviewThenConfirm(p: { client_id: string; valid_from: string; timezone: string; cc: string[]; bcc: string[]; include_attachment: boolean; rates: unknown[] }): Promise<void> {
    setBusy(true); setMsg('');
    try {
      setPreview(await api<Preview>('/rate-notifications/preview', { method: 'POST', body: JSON.stringify(p) }));
      setConfirming(true);
    } catch (e) { setMsg(`Preview failed: ${(e as Error).message}`); }
    setBusy(false);
  }

  async function doSend(): Promise<void> {
    const p = payload();
    if (!p) return;
    setBusy(true); setMsg('');
    try {
      const r = await api<{ id: string; recipient_count: number; dest_count: number }>('/rate-notifications', { method: 'POST', body: JSON.stringify(p) });
      push(true, 'Rate notification sent ✓');
      setResult({ ok: true, id: r.id, recipient_count: r.recipient_count, dest_count: r.dest_count });
      setConfirming(false);
    } catch (e) {
      const msg = (e as Error).message;
      push(false, 'Failed to send notification');
      setResult({ ok: false, error: msg });
      setConfirming(false);
    }
    setBusy(false);
  }

  const subject = client ? `8xtel Rate notification _${client.account_id}/${client.system_id}` : '—';
  const steps = ['Client & Recipients', 'Rate Details', 'Review & Preview', 'Send'];
  const reviewRates = useMemo(() => dests.filter((d) => d.country && d.rate), [dests]);
  const reviewCountries = useMemo(() => new Set(reviewRates.map((d) => d.country)).size, [reviewRates]);
  const reviewCurrencies = useMemo(() => [...new Set(reviewRates.map((d) => d.currency))].join(' / '), [reviewRates]);
  const reviewModes = useMemo(() => [...new Set(reviewRates.map((d) => d.billing_mode))].map(bmLabel).join(', '), [reviewRates]);

  if (result) {
    return (
      <div className="max-w-lg mx-auto text-center">
        <div className={`card card-pad py-10 ${result.ok ? '' : '!border-red-500/40'}`}>
          <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-4 ${result.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
            {result.ok ? '✓' : '✕'}
          </div>
          <div className="font-bold text-lg">{result.ok ? 'Rate Notification Sent Successfully' : 'Rate Notification Failed'}</div>
          {result.ok ? (
            <div className="text-sm text-muted mt-2 space-y-1">
              <div>Notification ID: <span className="mono">{result.id ? rnShortId(result.id) : ''}</span></div>
              <div>Recipients: {result.recipient_count} · Destinations: {result.dest_count}</div>
              <div>Sent: {new Date().toLocaleString('en-GB')}</div>
            </div>
          ) : (
            <div className="text-sm text-red-300 mt-2 break-all">{result.error}</div>
          )}
          <div className="flex gap-2 justify-center mt-5">
            {result.ok && result.id && <Link className="btn !text-xs" to={`/rate-notifications/${result.id}`}>View Notification</Link>}
            {!result.ok && <button className="btn !text-xs" onClick={() => { setResult(null); setStep(3); }}>Edit Notification</button>}
            {!result.ok && <button className="btn-ghost !text-xs" onClick={() => { setResult(null); void doSend(); }}>Retry</button>}
            <Link className="btn-ghost !text-xs" to="/rate-notifications">Back to History</Link>
          </div>
        </div>
        <Toasts toasts={toasts} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Create Rate Notification" sub="Guided workflow — client, rates, review, send." actions={<Link className="btn-ghost" to="/rate-notifications">← History</Link>} />
      <div className="flex items-center gap-1 my-4 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <button
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${step === i + 1 ? 'border-brand/50 bg-brand/10 text-white' : step > i + 1 ? 'border-emerald-500/30 text-emerald-300' : 'border-line text-muted'}`}
              onClick={() => { if (i + 1 < step) setStep(i + 1); }}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === i + 1 ? 'bg-brand text-white' : step > i + 1 ? 'bg-emerald-500/20' : 'bg-panel2'}`}>{step > i + 1 ? '✓' : i + 1}</span>
              {s}
            </button>
            {i < steps.length - 1 && <span className="text-muted px-0.5">→</span>}
          </div>
        ))}
      </div>
      {msg && <div className="card card-pad mb-3 text-sm">{msg}</div>}
      {formError && <div className="text-sm text-red-300 mb-3">⚠ {formError}</div>}

      {step === 1 && (
      <div className="card card-pad mb-3">
        <div className="card-title mb-2">Step 1 · Client & Recipients</div>
        {!client ? (
          <div>
            <input className="input" placeholder="Search name, company, system ID or email…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 max-h-48 overflow-y-auto divide-y divide-line/50">
              {opts.map((c) => (
                <button key={c.id} className="w-full text-left py-2 px-1 hover:bg-ink/60" onClick={() => pickClient(c)}>
                  <span className="text-sm font-semibold">{c.name}</span>
                  <span className="text-xs text-muted ml-2 mono">{c.system_id}</span>
                  <span className="text-xs text-muted ml-2">{c.email ?? 'no email'}</span>
                </button>
              ))}
              {!opts.length && <div className="text-xs text-muted py-2">Type to search clients…</div>}
            </div>
          </div>
        ) : (
          <div className="text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="label">Client</span><div className="font-semibold">{client.name}</div></div>
              <div><span className="label">Destination Account ID</span><div className="mono">{client.account_id}</div></div>
              <div><span className="label">System ID</span><div className="mono">{client.system_id}</div></div>
              <div><span className="label">Portal email</span><div className="mono">{client.portal_email ?? '—'}</div></div>
            </div>
            <div className="mt-2 rounded-lg border border-line/60 p-2.5">
              <label className="label">Send mail to (client's rates email) — add / update</label>
              <div className="flex gap-2">
                <input className="input mono" value={rateEmailDraft} onChange={(e) => setRateEmailDraft(e.target.value)} placeholder={client.portal_email ?? 'rates-client@example.com'} />
                <button className="btn-ghost !text-xs whitespace-nowrap" onClick={() => void saveRateEmail()} disabled={busy}>Save email</button>
              </div>
              <div className="text-[11px] text-muted mt-1">Recipient: <span className="mono">{client.email ?? '— none set —'}</span>{client.rate_email ? '' : client.portal_email ? ' (falls back to portal email)' : ''}</div>
            </div>
            <button className="btn-ghost !py-1 !text-xs justify-self-start mt-2" onClick={() => setClient(null)}>Change client</button>
          </div>
        )}
        <div className="mt-2 text-xs text-muted">Subject: <span className="mono">{subject}</span></div>
        {client && (
          <div className="mt-3 space-y-3 rounded-lg border border-line/60 p-3">
            <div className="card-title !text-xs">Email Recipients</div>
            <div>
              <label className="label">TO (client primary email)</label>
              <div className="badge border border-brand/30 bg-brand/10 !text-xs !py-1 !px-2.5"><span className="mono">{client.email ?? '— none set —'}</span></div>
            </div>
            <RecipientPicker label="CC — multiple allowed" values={cc} onChange={setCc} exclude={[...bcc, client.email ?? '']} />
            <RecipientPicker label="BCC — multiple allowed, hidden from TO/CC" values={bcc} onChange={setBcc} exclude={[...cc, client.email ?? '']} />
          </div>
        )}
        <div className="flex gap-2 mt-3 justify-end">
          <button className="btn !text-xs" disabled={!client || !client.email} onClick={() => { if (!client?.email) { setFormError('Select a client with an email first.'); return; } setFormError(''); setStep(2); }}>Continue →</button>
        </div>
      </div>
      )}

      {step === 2 && (
      <>
      <div className="card card-pad mb-3">
        <div className="card-title mb-2">Step 2 · Rate Details</div>
        {dests.map((d, i) => (
          <div key={i} className="rounded-lg border border-line/60 p-3 mb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold">Destination {i + 1}</span>
              {dests.length > 1 && <button className="btn-ghost !py-0.5 !px-2 !text-[11px] text-red-300" onClick={() => setDests((ds) => ds.filter((_, j) => j !== i))}>Remove</button>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label">Country</label>
                <input className="input" list={`rn-countries-${i}`} value={d.country} onChange={(e) => pickCountry(i, e.target.value)} placeholder="Singapore" />
                <datalist id={`rn-countries-${i}`}>{countries.map((c) => <option key={c.iso_code} value={c.name} />)}</datalist>
              </div>
              <div className="col-span-2"><label className="label">Network</label><input className="input" value={d.network_name} onChange={(e) => setDest(i, { network_name: e.target.value })} placeholder="Singapore - Default" /></div>
              <div><label className="label">MCC</label><input className="input mono" value={d.mcc} onChange={(e) => setDest(i, { mcc: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="525" inputMode="numeric" /></div>
              <div>
                <label className="label">MCC/MNC</label>
                <select className="input" value={d.mncMode} onChange={(e) => setDest(i, { mncMode: e.target.value as 'all' | 'specific', mnc: e.target.value === 'all' ? 'ALL' : '' })}>
                  <option value="all">Default / All</option>
                  <option value="specific">Specific</option>
                </select>
              </div>
              <div><label className="label">MNC{d.mncMode === 'all' && ' (auto: ALL)'}</label><input className="input mono" value={d.mnc} disabled={d.mncMode === 'all'} onChange={(e) => setDest(i, { mnc: e.target.value })} placeholder="01" /></div>
              <div>
                <label className="label">Currency</label>
                <select className="input" value={d.currency} onChange={(e) => setDest(i, { currency: e.target.value as 'EUR' | 'USD' })}>
                  <option value="EUR">EUR (€)</option><option value="USD">USD ($)</option>
                </select>
              </div>
              <div className="col-span-2"><label className="label">Rate (exact, no conversion)</label><input className="input mono" value={d.rate} onChange={(e) => setDest(i, { rate: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.017" inputMode="decimal" /></div>
              <div className="col-span-2">
                <label className="label">Billing Mode <span className="text-muted font-normal" title={bmHelp(d.billing_mode)}>ⓘ {bmHelp(d.billing_mode)}</span></label>
                <select className="input" value={d.billing_mode} onChange={(e) => setDest(i, { billing_mode: e.target.value as BillingModeV })}>
                  {BILLING_MODES.map((b) => <option key={b.v} value={b.v} title={b.help}>{b.label}</option>)}
                </select>
                <div className="mt-1"><BmPill mode={d.billing_mode} /></div>
              </div>
              {(d.billing_mode === 'submission_delivery' || d.billing_mode === 'hybrid') && (
                <div><label className="label">Delivery Rate ({d.currency})</label><input className="input mono" value={d.delivery_rate} onChange={(e) => setDest(i, { delivery_rate: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.002" inputMode="decimal" /></div>
              )}
            </div>
          </div>
        ))}
        <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setDests((ds) => [...ds, emptyDest()])}>+ Add Destination</button>
        {client && savedLoaded && (
          <div className="mt-2 text-xs text-muted">
            {saved.length
              ? <span>✓ {saved.length} saved rate{saved.length > 1 ? 's' : ''} loaded for {client.name} — sending auto-saves any changes. <button className="link" onClick={() => setManageRates((v) => !v)}>{manageRates ? 'Hide' : 'Add / update rates'}</button></span>
              : <span>No saved rates for {client.name} yet — add destinations below, then <button className="link" onClick={() => setManageRates((v) => !v)}>save them</button> or just send (auto-saves).</span>}
          </div>
        )}

      {client && manageRates && (
        <div className="card card-pad mb-3">
          <div className="card-title mb-1">Add / update saved rates — {client.name}</div>
          <p className="text-[11px] text-muted mb-2">Saved rates prefill automatically next time you select this client. Sending a notification also auto-saves.</p>
          {dests.map((d, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 border-b border-line/40 text-xs">
              <span className="flex-1">{d.country || '—'} · {d.network_name || '—'} · {d.mcc || '—'}/{d.mncMode === 'all' ? 'ALL' : d.mnc || '—'} · {d.currency} {d.rate || '—'} · {bmLabel(d.billing_mode)}{(d.billing_mode === 'submission_delivery' || d.billing_mode === 'hybrid') && d.delivery_rate ? ` +${d.delivery_rate}` : ''}</span>
              <button className="btn-ghost !py-0.5 !px-2 !text-[11px]" onClick={() => void saveRate(i)} disabled={busy || !d.country || !d.rate}>Save rate</button>
            </div>
          ))}
          {saved.length > 0 && (
            <div className="mt-2">
              <div className="label">Saved ({saved.length})</div>
              {saved.map((r) => (
                <div key={r.id} className="flex items-center gap-2 py-1 text-xs">
                  <span className="flex-1">{r.country} · {r.network_name} · {r.mcc}/{r.mnc} · {r.currency} {Number(r.rate).toFixed(3)}{r.delivery_rate ? ` +${Number(r.delivery_rate).toFixed(3)}` : ''} · {bmLabel(r.billing_mode)}</span>
                  <button className="btn-ghost !py-0.5 !px-2 !text-[11px] text-red-300" onClick={() => void deleteSaved(r.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      <div className="card card-pad mb-3">
        <div className="card-title mb-2">Valid From (GMT)</div>
        <input type="datetime-local" className="input max-w-[260px]" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <div className="flex gap-2 mt-3 justify-between">
          <button className="btn-ghost !text-xs" onClick={() => setStep(1)}>← Edit</button>
          <button className="btn !text-xs" onClick={() => { const p = payload(); if (p) { setFormError(''); setStep(3); void doPreview(); } }} disabled={busy}>Review & Preview →</button>
        </div>
      </div>
      </>
      )}
      {step === 3 && (
      <div className="card card-pad mb-3">
        <div className="card-title mb-2">Step 3 · Review & Preview</div>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-line/60 p-3"><div className="label">Client</div><div className="font-semibold">{client?.name}</div><div className="text-xs text-muted">Account: <span className="mono">{client?.account_id} / {client?.system_id}</span></div></div>
          <div className="rounded-lg border border-line/60 p-3"><div className="label">Recipients</div><div className="text-xs">TO: <span className="mono">{client?.email}</span></div>{!!cc.length && <div className="text-xs">CC: <span className="mono break-all">{cc.join(', ')}</span></div>}{!!bcc.length && <div className="text-xs">BCC: <span className="mono break-all">{bcc.join(', ')}</span></div>}</div>
          <div className="rounded-lg border border-line/60 p-3 md:col-span-2"><div className="label">Rates</div><div className="text-xs text-muted">{reviewCountries} Countries · {reviewRates.length} Networks · Currencies: {reviewCurrencies || '—'} · Billing Modes: {reviewModes || '—'}</div><div className="text-xs text-muted">Valid From: {validFrom.replace('T', ' ')} GMT</div></div>
          <div className="rounded-lg border border-line/60 p-3 md:col-span-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input type="checkbox" checked={includeAttachment} onChange={(e) => { setIncludeAttachment(e.target.checked); setAttachSample(null); }} />
                Attach complete client rate Excel
              </label>
              {includeAttachment && <button className="btn-ghost !text-xs !py-1" onClick={() => void loadAttachSample()} disabled={attachLoading || !client}>{attachLoading ? 'Generating…' : 'Preview Excel'}</button>}
            </div>
            {includeAttachment && preview?.attachment && (
              <div className="text-xs text-muted mt-2">
                <div>📎 <span className="mono">{preview.attachment.filename}</span></div>
                {preview.attachment.error
                  ? <div className="text-red-300">{preview.attachment.error}</div>
                  : <div>Active Routes: {preview.attachment.route_count} · Countries: {preview.attachment.countries} · Networks: {preview.attachment.networks} · Currency: {preview.attachment.currency}</div>}
              </div>
            )}
            {includeAttachment && attachSample && !attachSample.empty && (
              <div className="overflow-x-auto mt-2">
                <table className="tbl">
                  <thead><tr><th>Country</th><th>Operator (All)</th><th>MCC</th><th>MNC</th><th className="!text-right">Rate</th><th>Currency</th><th>Time</th></tr></thead>
                  <tbody>{attachSample.sample.map((r, i) => (
                    <tr key={i}><td>{r.country}</td><td>{r.operator}</td><td className="mono">{r.mcc}</td><td className="mono">{r.mnc}</td><td className="!text-right mono">{Number(r.rate).toFixed(4)}</td><td className="mono">{r.currency}</td><td className="mono text-xs">{r.time}</td></tr>
                  ))}</tbody>
                </table>
                <div className="text-[11px] text-muted mt-1">Showing first {attachSample.sample.length} of {attachSample.route_count} active routes.</div>
              </div>
            )}
            {includeAttachment && attachSample?.empty && <div className="text-xs text-red-300 mt-2">No active rates found for this client account. Please verify the client's route/rate configuration before sending the notification.</div>}
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="btn-ghost !text-xs" onClick={() => setStep(2)}>← Edit</button>
          <button className="btn-ghost !text-xs" onClick={() => void doPreview()} disabled={busy}>{busy ? 'Working…' : 'Preview Email'}</button>
          <button className="btn !text-xs" onClick={() => { const p = payload(); if (p) { if (includeAttachment && preview?.attachment?.empty) { setFormError('No active rates found for this client — uncheck the Excel attachment or fix the route configuration.'); return; } setFormError(''); void doPreviewThenConfirm(p); } }} disabled={busy}>Continue to Send →</button>
        </div>
        {preview && (
          <div className="mt-3">
            <div className="card-title mb-2 !text-xs">Email Preview</div>
            <div className="text-xs mb-2 space-y-0.5 rounded-lg bg-panel2/60 border border-line/60 p-3">
              <div><span className="text-muted">From: </span>{preview.from_name} &lt;<span className="mono">{preview.from}</span>&gt;</div>
              <div><span className="text-muted">To: </span><span className="mono">{preview.to}</span></div>
              {!!preview.cc.length && <div><span className="text-muted">CC: </span><span className="mono">{preview.cc.join(', ')}</span></div>}
              <div><span className="text-muted">Subject: </span><span className="mono">{preview.subject}</span></div>
              <div className="text-muted italic">BCC is never shown in the client-facing preview.</div>
            </div>
            <iframe title="preview" className="w-full rounded-lg border border-line bg-white" style={{ height: 520 }} srcDoc={preview.html} />
          </div>
        )}
      </div>
      )}

      {confirming && preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirming(false)}>
          <div className="card card-pad max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="card-title mb-2">Send Rate Notification?</div>
            <div className="text-xs text-muted mb-3">You are about to send:</div>
            <div className="text-sm space-y-1 mb-4">
              <div><span className="text-muted">TO: </span><span className="mono break-all">{preview.to}</span></div>
              {!!preview.cc.length && <div><span className="text-muted">CC: </span><span className="mono break-all">{preview.cc.join(', ')}</span></div>}
              {!!preview.bcc.length && <div><span className="text-muted">BCC: </span><span className="mono break-all">{preview.bcc.join(', ')}</span></div>}
              <div><span className="text-muted">Subject: </span><span className="mono break-all">{preview.subject}</span></div>
              <div><span className="text-muted">Destinations: </span>{dests.length}</div>
              {preview.attachment && !preview.attachment.empty && <div><span className="text-muted">Attachment: </span>📎 <span className="mono break-all">{preview.attachment.filename}</span> <span className="text-muted">({preview.attachment.route_count} routes)</span></div>}
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn" onClick={() => void doSend()} disabled={busy}>{busy ? 'Sending…' : 'Confirm & Send'}</button>
            </div>
          </div>
        </div>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

export function RateNotificationContacts(): JSX.Element {
  const [rows, setRows] = useState<Contact[]>([]);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [defCc, setDefCc] = useState(false);
  const [defBcc, setDefBcc] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const { toasts, push } = useToasts();
  function load(): void {
    api<{ contacts: Contact[] }>(`/rate-notifications/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setRows(r.contacts)).catch((e) => push(false, `Load failed: ${(e as Error).message}`));
  }
  useEffect(load, []);
  async function save(): Promise<void> {
    try {
      await api('/rate-notifications/contacts', { method: 'POST', body: JSON.stringify({ display_name: name.trim(), email: email.trim().toLowerCase(), is_default_cc: defCc, is_default_bcc: defBcc }) });
      push(true, 'Contact saved ✓');
      setName(''); setEmail(''); setDefCc(false); setDefBcc(false);
      load();
    } catch (e) { push(false, `Save failed: ${(e as Error).message}`); }
  }
  async function toggle(c: Contact, field: 'is_default_cc' | 'is_default_bcc'): Promise<void> {
    try {
      await api(`/rate-notifications/contacts/${c.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: !c[field] }) });
      push(true, 'Contact saved ✓');
      load();
    } catch (e) { push(false, `Update failed: ${(e as Error).message}`); }
  }
  async function remove(c: Contact): Promise<void> {
    if (!window.confirm(`Delete contact ${c.email}? History is unaffected.`)) return;
    try {
      await api(`/rate-notifications/contacts/${c.id}`, { method: 'DELETE' });
      push(true, 'Contact removed ✓');
      load();
    } catch (e) { push(false, `Delete failed: ${(e as Error).message}`); }
  }
  async function saveEdit(): Promise<void> {
    if (!editing) return;
    try {
      await api(`/rate-notifications/contacts/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ display_name: editing.display_name }) });
      push(true, 'Contact saved ✓');
      setEditing(null);
      load();
    } catch (e) { push(false, `Update failed: ${(e as Error).message}`); }
  }
  return (
    <div>
      <PageHeader title="Saved Email Contacts" sub="Frequently used CC / BCC addresses for rate notifications." actions={<Link className="btn-ghost" to="/rate-notifications">← History</Link>} />
      <div className="card card-pad my-4">
        <div className="card-title mb-2">Add New Contact</div>
        <div className="grid md:grid-cols-4 gap-2">
          <div><label className="label">Display Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rates Manager" /></div>
          <div><label className="label">Email Address</label><input className="input mono" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@example.com" /></div>
          <div className="flex items-end gap-3 pb-2 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={defCc} onChange={(e) => setDefCc(e.target.checked)} /> Default CC</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={defBcc} onChange={(e) => setDefBcc(e.target.checked)} /> Default BCC</label>
          </div>
          <div className="flex items-end"><button className="btn !text-xs" onClick={() => void save()} disabled={!name.trim() || !email.trim()}>Save Contact</button></div>
        </div>
      </div>
      <div className="card card-pad mb-3">
        <input className="input max-w-sm" placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Name</th><th>Email</th><th>Default CC</th><th>Default BCC</th><th>Last Used</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="font-medium">{c.display_name}</td>
              <td className="mono text-xs">{c.email}</td>
              <td><button className={`badge border ${c.is_default_cc ? 'border-brand/40 bg-brand/10 text-emerald-300' : 'border-line text-muted'}`} onClick={() => void toggle(c, 'is_default_cc')}>{c.is_default_cc ? '✓ Default' : 'Set Default'}</button></td>
              <td><button className={`badge border ${c.is_default_bcc ? 'border-brand/40 bg-brand/10 text-emerald-300' : 'border-line text-muted'}`} onClick={() => void toggle(c, 'is_default_bcc')}>{c.is_default_bcc ? '✓ Default' : 'Set Default'}</button></td>
              <td className="text-xs">{c.last_used_at ? fmtDT(c.last_used_at) : '—'}</td>
              <td><StatusBadge status="active" /></td>
              <td className="whitespace-nowrap">
                <button className="link text-xs mr-2" onClick={() => setEditing(c)}>Edit</button>
                <button className="link text-xs text-red-300" onClick={() => void remove(c)}>Delete</button>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="text-center text-muted py-6">No saved contacts yet.</td></tr>}
        </tbody>
      </table></div></div>
      {editing && (
        <Modal title={`Edit — ${editing.email}`} onClose={() => setEditing(null)}>
          <label className="label">Display Name</label>
          <input className="input mb-3" value={editing.display_name} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} />
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost !text-xs" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn !text-xs" onClick={() => void saveEdit()}>Save</button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
