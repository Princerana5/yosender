import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, StatusBadge, DataTable, Icon, Money, Modal } from '../components';

interface Ip {
  id: string;
  ip: string;
  enabled: boolean;
}

interface Stats {
  traffic_today: number;
  traffic_all_time: number;
  delivered: number;
  delivery_pct: number;
  balance: number;
  currency: string;
  total_topped_up: number;
  total_spent: number;
}

interface Issued {
  system_id: string;
  password: string;
  host: string;
  port: number;
}

function curSym(c: string): string {
  if (c === 'EUR') return '€';
  if (c === 'INR') return '₹';
  return '$';
}

export default function ClientDetail(): JSX.Element {
  const { id } = useParams();
  const [data, setData] = useState<{
    client: Record<string, string>;
    ips: Ip[];
    rates: Array<Record<string, string>>;
    stats: Stats;
  } | null>(null);
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);

  const load = (): void => {
    api<NonNullable<typeof data>>(`/clients/${id}`).then(setData).catch(() => undefined);
  };
  useEffect(load, [id]);

  async function patch(body: object): Promise<void> {
    setBusy(true);
    try {
      await api(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } finally {
      setBusy(false);
    }
  }
  async function addIp(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!ip.trim()) return;
    await api(`/clients/${id}/ips`, { method: 'POST', body: JSON.stringify({ ip: ip.trim() }) });
    setIp('');
    load();
  }
  async function reissue(): Promise<void> {
    const ok = window.confirm('Generate a NEW password? The old one stops working immediately. The new password is shown once.');
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<Issued>(`/clients/${id}/credentials`, { method: 'POST' });
      setIssued(r);
    } finally {
      setBusy(false);
    }
  }
  function copyCreds(): void {
    if (!issued) return;
    const msg = `Your SMPP account is ready.\nHost: ${issued.host}\nPort: ${issued.port}\nUsername: ${issued.system_id}\nPassword: ${issued.password}`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }
  function removeIp(ipId: string, ipAddr: string): void {
    if (!window.confirm(`Remove ${ipAddr}?`)) return;
    api(`/clients/${id}/ips/${ipId}`, { method: 'DELETE' }).then(load);
  }

  if (!data) {
    return <div className="card card-pad animate-pulse"><div className="h-6 w-48 bg-line rounded" /></div>;
  }
  const c = data.client;
  const s = data.stats;
  const sym = curSym(s.currency);

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        sub=""
        actions={<Link className="btn-ghost" to="/clients">← All clients</Link>}
      />
      <div className="flex items-center gap-2 -mt-3 text-[13px] text-muted">
        <span className="font-mono bg-panel border border-line rounded px-2 py-0.5">{c.system_id}</span>
        <StatusBadge status={c.status} />
      </div>

      <div className="card card-pad border-brand/30">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="card-title">SMPP credentials</div>
            <div className="card-sub">Username is fixed · password is hashed — reveal means re-issue (shown once)</div>
          </div>
          <button className="btn !py-1.5 !text-xs" onClick={reissue} disabled={busy}>
            <Icon name="refresh" size={13} /> {busy ? 'Working…' : 'Show / re-issue password'}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-2.5 mt-3 max-w-2xl">
          <div className="rounded-lg bg-ink/60 border border-line px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Username (system_id)</div>
            <div className="font-mono text-[15px] text-sky-300 select-all">{c.system_id}</div>
          </div>
          <div className="rounded-lg bg-ink/60 border border-line px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Password</div>
            <div className="font-mono text-[15px] text-muted">••••••••••••</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card card-pad">
          <div className="stat-label">Current balance</div>
          <div className="stat-value text-emerald-300">{sym}{s.balance.toFixed(2)}</div>
          <div className="text-xs text-muted mt-1">{s.currency} · credit <Money value={c.credit_limit} /></div>
        </div>
        <div className="card card-pad">
          <div className="stat-label">Total topped up (all time)</div>
          <div className="stat-value">{sym}{s.total_topped_up.toFixed(2)}</div>
          <div className="text-xs text-muted mt-1">Sum of all credits</div>
        </div>
        <div className="card card-pad">
          <div className="stat-label">Total spent (all time)</div>
          <div className="stat-value text-amber-300">{sym}{s.total_spent.toFixed(2)}</div>
          <div className="text-xs text-muted mt-1">Sum of SMS debits</div>
        </div>
        <div className="card card-pad">
          <div className="stat-label">Throughput</div>
          <div className="stat-value tabular-nums">{c.tps_limit} <span className="text-sm font-medium text-muted">TPS</span></div>
          <div className="text-xs text-muted mt-1">Daily {c.daily_limit ?? '∞'} · Monthly {c.monthly_limit ?? '∞'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card card-pad">
          <div className="stat-label">Traffic sent · today</div>
          <div className="stat-value tabular-nums">{s.traffic_today.toLocaleString()}</div>
        </div>
        <div className="card card-pad">
          <div className="stat-label">Traffic sent · all time</div>
          <div className="stat-value tabular-nums">{s.traffic_all_time.toLocaleString()}</div>
        </div>
        <div className="card card-pad">
          <div className="stat-label">Delivered</div>
          <div className="stat-value text-emerald-300 tabular-nums">{s.delivered.toLocaleString()}</div>
          <div className="text-xs text-muted mt-1">{s.delivery_pct}% delivery rate</div>
        </div>
        <div className="card card-pad">
          <div className="stat-label">Account actions</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {['active', 'suspended', 'blocked'].map((st) => (
              <button key={st} disabled={busy} onClick={() => patch({ status: st })}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${c.status === st
                  ? 'border-brand/50 text-emerald-300 bg-brand/10'
                  : 'border-line text-muted hover:text-white hover:border-brand/40'}`}>
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title">IP whitelist</div>
        <div className="card-sub">Binds from any other IP are rejected and logged.</div>
        <form onSubmit={addIp} className="flex gap-2 mt-3 max-w-lg">
          <input className="input font-mono" placeholder="103.20.10.5 or 103.20.10.0/24" value={ip}
            onChange={(e) => setIp(e.target.value)} />
          <button className="btn shrink-0" type="submit"><Icon name="plus" size={14} /> Add</button>
        </form>
        <div className="mt-3 space-y-1.5">
          {data.ips.map((i) => (
            <div key={i.id} className="flex items-center gap-2.5 text-sm bg-ink/50 border border-line/60 rounded-lg px-3 py-2 max-w-lg">
              <span className="font-mono text-[13px]">{i.ip}</span>
              <StatusBadge status={i.enabled ? 'enabled' : 'disabled'} />
              <div className="ml-auto flex gap-1.5">
                <button className="btn-ghost !px-2 !py-1 !text-xs"
                  onClick={() => api(`/clients/${id}/ips/${i.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !i.enabled }) }).then(load)}>
                  {i.enabled ? 'Disable' : 'Enable'}
                </button>
                <button className="btn-ghost !px-2 !py-1 !text-xs hover:!border-danger/50 hover:!text-red-300"
                  onClick={() => removeIp(i.id, i.ip)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          {!data.ips.length && (
            <div className="text-sm text-muted border border-dashed border-line rounded-lg px-3 py-3 max-w-lg">
              No IPs configured — binds accepted from anywhere. Add at least one to lock this account down.
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="card-title mb-2 px-1">Client rates</div>
        <DataTable
          keyOf={(_, i) => String(i)}
          rows={data.rates}
          empty="No rates configured for this client yet."
          columns={[
            { key: 'country_name', label: 'Country' },
            { key: 'prefix', label: 'Prefix', mono: true, render: (r) => (r as Record<string, string>).prefix ?? '*' },
            { key: 'price', label: 'Price / SMS', right: true, render: (r) => <Money value={(r as Record<string, string>).price} /> },
          ]}
        />
      </div>

      {issued && (
        <Modal title="New password issued" onClose={() => setIssued(null)}>
          <p className="text-xs text-muted mb-3">Copy now — it cannot be retrieved again. The old password is already revoked.</p>
          <div className="rounded-lg bg-ink border border-line p-3.5 font-mono text-[13px] leading-relaxed space-y-1">
            <div className="flex justify-between"><span className="text-muted">Host</span><span>{issued.host}</span></div>
            <div className="flex justify-between"><span className="text-muted">Port</span><span>{issued.port}</span></div>
            <div className="flex justify-between"><span className="text-muted">Username</span><span className="text-sky-300">{issued.system_id}</span></div>
            <div className="flex justify-between"><span className="text-muted">Password</span><span className="text-amber-300 select-all">{issued.password}</span></div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn flex-1" onClick={copyCreds}>{copied ? 'Copied ✓' : 'Copy handoff'}</button>
            <button className="btn-ghost" onClick={() => setIssued(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
