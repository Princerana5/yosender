import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { portalApi } from '../portal';
import { PageHeader, DataTable, StatusBadge } from '../components';

export function PortalRcsHistory(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [f, setF] = useState({ destination: '', status: '' });
  const load = (): void => {
    const p = new URLSearchParams(); if (f.destination) p.set('destination', f.destination); if (f.status) p.set('status', f.status);
    portalApi<{ messages: Record<string, unknown>[] }>(`/portal/rcs/messages?${p}`).then((r) => setRows(r.messages)).catch(() => undefined);
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-5">
      <PageHeader title="RCS History" sub="Your RCS messages and delivery status" />
      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="w-56"><label className="label">Destination</label><input className="input font-mono" placeholder="+9198…" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
        <div className="w-44"><label className="label">Status</label><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{['queued', 'accepted', 'submitted', 'delivered', 'undelivered', 'expired', 'rejected', 'failed'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <button className="btn" onClick={load}>Search</button>
      </div>
      <DataTable keyOf={(r) => String(r.id)} rows={rows} empty="No RCS messages yet — use Send RCS." columns={[
        { key: 'created_at', label: 'Time', render: (r) => <span className="text-xs text-muted whitespace-nowrap">{r.created_at ? new Date(String(r.created_at)).toLocaleString() : '—'}</span> },
        { key: 'sender', label: 'Sender', mono: true },
        { key: 'destination', label: 'To', mono: true },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
        { key: 'price', label: 'Price', render: (r) => <span className="font-mono text-xs">{String(r.price ?? '—')}</span> },
      ]} />
    </div>
  );
}

export function PortalRcsReports(): JSX.Element {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { portalApi<{ campaigns: Record<string, unknown>[] }>('/portal/rcs/campaigns').then((r) => setRows(r.campaigns)).catch(() => undefined); }, []);
  return (
    <div className="space-y-5">
      <PageHeader title="RCS Reports" sub="Campaign overview" />
      <DataTable keyOf={(r) => String(r.id)} rows={rows} empty="No RCS campaigns yet." columns={[
        { key: 'created_at', label: 'Time', render: (r) => <span className="text-xs text-muted whitespace-nowrap">{r.created_at ? new Date(String(r.created_at)).toLocaleString() : '—'}</span> },
        { key: 'name', label: 'Campaign', render: (r) => <Link className="font-semibold text-sky-300 hover:underline" to={`/portal/rcs/reports/${String(r.id)}`}>{String(r.name)}</Link> },
        { key: 'sender', label: 'Sender', mono: true },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
        { key: 'recipient_count', label: 'Recipients' },
      ]} />
    </div>
  );
}

export function PortalRcsReportDetail(): JSX.Element {
  const { id } = useParams();
  const [camp, setCamp] = useState<Record<string, unknown> | null>(null);
  const [recips, setRecips] = useState<Record<string, unknown>[]>([]);
  const [mix, setMix] = useState<{ delivered: string; failed: string; pending: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    portalApi<{ campaign: Record<string, unknown>; recipients: Record<string, unknown>[]; mix: typeof mix }>(`/portal/rcs/campaigns/${id}`)
      .then((r) => { setCamp(r.campaign); setRecips(r.recipients); setMix(r.mix); }).catch(() => undefined);
  }, [id]);
  if (!camp) return <div className="card card-pad animate-pulse"><div className="h-6 w-48 bg-line rounded" /></div>;
  return (
    <div className="space-y-5">
      <PageHeader title={String(camp.name)} sub={`${camp.sender} · ${String(camp.status)} · ${new Date(String(camp.created_at)).toLocaleString()}`} actions={<Link className="btn-ghost !py-1.5 !text-xs" to="/portal/rcs/reports">← All RCS reports</Link>} />
      {mix && <div className="grid grid-cols-3 gap-3">
        <div className="stat-card"><div className="stat-label">Delivered</div><div className="stat-value text-emerald-300">{String(mix.delivered)}</div></div>
        <div className="stat-card"><div className="stat-label">Failed</div><div className="stat-value text-red-300">{String(mix.failed)}</div></div>
        <div className="stat-card"><div className="stat-label">Pending</div><div className="stat-value">{String(mix.pending)}</div></div>
      </div>}
      <DataTable keyOf={(r, i) => `${String(r.destination)}-${i}`} rows={recips} empty="No recipients." columns={[
        { key: 'destination', label: 'Number', mono: true },
        { key: 'validation_status', label: 'Validation', render: (r) => <StatusBadge status={String(r.validation_status === 'valid' ? 'delivered' : r.validation_status === 'duplicate' ? 'submitted' : 'failed')} /> },
        { key: 'reason', label: 'Reason', render: (r) => String(r.reason ?? '—') },
      ]} />
    </div>
  );
}
