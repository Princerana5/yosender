import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, Icon, Money } from '../components';

interface VaultRow {
  id: string; name: string; company_name: string | null; system_id: string;
  status: string; balance: string; credit_limit: string; currency: string;
  tps_limit: number; portal_email: string | null; portal_enabled: boolean;
  is_house: boolean; rcs_enabled: boolean;
  has_smpp_password: boolean; has_portal_password: boolean;
  ip_count: string; bind_count: string; bind_last_activity: string | null;
  last_seen_at: string | null; api_key_count: string;
  wallet_balance: string; sms_credits: string; created_at: string;
}

type Kind = 'all' | 'smpp' | 'portal';

function roleFromToken(): string | null {
  try {
    const t = localStorage.getItem('xtel_token');
    if (!t) return null;
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (p.role ?? p?.role) as string | null;
  } catch { return null; }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ClientVault(): JSX.Element {
  const isSuper = roleFromToken() === 'super_admin';
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [reveal, setReveal] = useState<{ label: string; username: string; password: string; hint: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  const load = (): void => {
    setErr('');
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (kind !== 'all') p.set('kind', kind);
    if (status) p.set('status', status);
    api<{ clients: VaultRow[]; total: number }>(`/clients/vault?${p.toString()}`)
      .then((r) => { setRows(r.clients); setTotal(r.total); })
      .catch((e) => setErr((e as Error).message));
  };
  useEffect(load, []);

  async function revealSmpp(row: VaultRow): Promise<void> {
    const ok = window.confirm(`Rotate SMPP password for "${row.name}" (${row.system_id})?\nOld password stops working immediately. New one is shown once.`);
    if (!ok) return;
    setBusy(`smpp:${row.id}`);
    try {
      const r = await api<{ system_id: string; password: string }>(`/clients/${row.id}/vault/reveal-smpp-password`, { method: 'POST' });
      setReveal({ label: 'SMPP credentials — send to client', username: r.system_id, password: r.password, hint: `SMPP bind to ${location.hostname}:2775 (system_id + password)` });
    } catch (e) { window.alert((e as Error).message); } finally { setBusy(''); }
  }

  async function revealPortal(row: VaultRow): Promise<void> {
    if (!row.portal_email) {
      window.alert('No portal email — set one in Client detail first.');
      return;
    }
    const ok = window.confirm(`Rotate portal password for "${row.name}" (${row.portal_email})?\nOld password stops working immediately.`);
    if (!ok) return;
    setBusy(`portal:${row.id}`);
    try {
      const r = await api<{ portal_email: string; password: string }>(`/clients/${row.id}/vault/reveal-portal-password`, { method: 'POST' });
      setReveal({ label: 'Portal login — send to client', username: r.portal_email, password: r.password, hint: `Portal ${location.origin}/portal/login` });
    } catch (e) { window.alert((e as Error).message); } finally { setBusy(''); }
  }

  function copyReveal(): void {
    if (!reveal) return;
    const msg = `${reveal.label}\nUsername/Email: ${reveal.username}\nPassword: ${reveal.password}\n${reveal.hint}`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  if (!isSuper) {
    return (
      <div className="space-y-5">
        <PageHeader title="Client Vault" sub="Super admin only — all clients, usernames & credential handoff" />
        <div className="card card-pad text-sm text-muted">
          You need <span className="font-mono font-semibold text-white">super_admin</span> to view the vault. Your current role is <span className="font-mono">{roleFromToken() ?? 'unknown'}</span>.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Client Vault"
        sub={`${total} account(s) · SMPP usernames + portal logins · super_admin only · passwords are rotated on reveal (shown once)`}
      />

      {err && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{err}</div>}

      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Search</label>
          <input className="input" placeholder="Name, company, system_id, portal email…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label className="label">Kind</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="all">All</option>
            <option value="smpp">SMPP</option>
            <option value="portal">Portal</option>
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="blocked">blocked</option>
            <option value="pending">pending</option>
          </select>
        </div>
        <button className="btn" onClick={load}>Search</button>
      </div>

      <DataTable
        keyOf={(r) => r.id}
        rows={rows}
        columns={[
          {
            key: 'name', label: 'Client',
            render: (r) => (
              <div>
                <Link className="font-semibold text-sky-300 hover:underline" to={`/clients/${(r as VaultRow).id}`}>
                  {(r as VaultRow).name}
                </Link>
                { (r as VaultRow).is_house && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-warn/15 text-amber-300 border border-warn/30">HOUSE</span>}
                <div className="text-[11px] text-muted truncate max-w-[160px]">{(r as VaultRow).company_name ?? (r as VaultRow).system_id}</div>
              </div>
            ),
          },
          {
            key: 'system_id', label: 'SMPP username', mono: true,
            render: (r) => <span className="font-mono text-xs">{(r as VaultRow).system_id}</span>,
          },
          {
            key: 'portal_email', label: 'Portal login',
            render: (r) => {
              const v = r as VaultRow;
              return v.portal_email ? (
                <span>
                  <span className="font-mono text-xs">{v.portal_email}</span>
                  <span className="ml-1"><StatusBadge status={v.portal_enabled ? 'enabled' : 'disabled'} /></span>
                </span>
              ) : <span className="text-muted text-xs">—</span>;
            },
          },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={(r as VaultRow).status} /> },
          {
            key: 'bind', label: 'Bind',
            render: (r) => {
              const v = r as VaultRow;
              const n = Number(v.bind_count ?? 0);
              return n > 0 ? <span title={`active ${timeAgo(v.bind_last_activity)}`}><StatusBadge status="connected" /></span>
                : <span title={`last seen ${timeAgo(v.last_seen_at)}`} className="text-[11px] text-muted">{v.last_seen_at ? timeAgo(v.last_seen_at) : 'never'}</span>;
            },
          },
          { key: 'tps_limit', label: 'TPS', right: true, render: (r) => <span className="tabular-nums text-xs">{(r as VaultRow).tps_limit}</span> },
          { key: 'balance', label: 'Balance', right: true, render: (r) => <Money value={(r as VaultRow).balance} /> },
          { key: 'ip_count', label: 'IPs', right: true, render: (r) => <span className="tabular-nums text-xs">{(r as VaultRow).ip_count}</span> },
          {
            key: 'creds', label: 'Credentials',
            render: (r) => {
              const v = r as VaultRow;
              return (
                <span className="flex gap-1 flex-wrap">
                  <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-amber-300 hover:border-amber-500/40"
                    disabled={!!busy} onClick={() => revealSmpp(v)}>
                    {busy === `smpp:${v.id}` ? '…' : 'SMPP pw'}
                  </button>
                  <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-sky-300 hover:border-sky-500/40 disabled:opacity-40"
                    disabled={!!busy || !v.portal_email} onClick={() => revealPortal(v)} title={v.portal_email ? 'Rotate portal password' : 'No portal email'}>
                    {busy === `portal:${v.id}` ? '…' : 'Portal pw'}
                  </button>
                </span>
              );
            },
          },
        ]}
      />

      <div className="text-[11px] text-muted">
        Passwords are hashed (bcrypt) — vault rotates and shows the new value once. Every reveal is audited. Copy the handoff and send it to the client; old password is revoked immediately.
      </div>

      {reveal && (
        <Modal title={reveal.label} onClose={() => setReveal(null)}>
          <div className="space-y-3">
            <p className="text-xs text-muted">Shown once — copy now. Stored only as a hash after this.</p>
            <div className="rounded-lg bg-ink border border-line p-3.5 font-mono text-[13px] space-y-1.5">
              <div className="flex justify-between gap-2"><span className="text-muted">Username/Email</span><span className="text-sky-300 select-all">{reveal.username}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted">Password</span><span className="text-amber-300 select-all">{reveal.password}</span></div>
              <div className="text-[11px] text-muted pt-1">{reveal.hint}</div>
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={copyReveal}>{copied ? 'Copied ✓' : 'Copy handoff message'}</button>
              <button className="btn-ghost" onClick={() => setReveal(null)}>Done</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
