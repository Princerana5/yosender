import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal, EmptyState, Icon } from '../components';

interface User {
  id: string; email: string; full_name: string | null; role: string;
  is_active: boolean; last_login_at: string | null; created_at: string;
}

interface Role {
  id: string; name: string; description: string | null;
}

interface Issued {
  user: User & { role: string };
  password: string;
  password_mode: 'manual' | 'generated';
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

const ROLE_BLURB: Record<string, string> = {
  super_admin: 'Everything — full access, user management, deletes.',
  admin: 'Most management: clients, vendors, routes, billing, users.',
  operations: 'Traffic, routes, connections, logs. No billing or users.',
  finance: 'Billing, rates and revenue reports only.',
  support: 'Read clients + messages + logs. No changes.',
  read_only: 'Dashboard and reports only.',
};

export default function UsersPage(): JSX.Element {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState({
    email: '', full_name: '', role: 'read_only',
    password: '', passwordMode: 'generate' as 'generate' | 'manual', showPw: false,
  });
  const [issued, setIssued] = useState<(Issued & { email: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetPw, setResetPw] = useState<{ email: string; password: string } | null>(null);

  const load = (): void => {
    api<{ users: User[] }>('/system/users').then((r) => setUsers(r.users)).catch(() => undefined);
    api<{ roles: Role[] }>('/system/roles').then((r) => setRoles(r.roles)).catch(() => undefined);
  };
  useEffect(load, []);

  function openModal(): void {
    setForm({ email: '', full_name: '', role: 'read_only', password: randomPassword(), passwordMode: 'generate', showPw: false });
    setFormErr('');
    setShow(true);
  }

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormErr('');
    try {
      const r = await api<Issued>('/system/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          full_name: form.full_name || undefined,
          role: form.role,
          ...(form.passwordMode === 'manual' ? { password: form.password } : {}),
        }),
      });
      setIssued({ ...r, email: r.user.email });
      setShow(false);
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setRole(u: User, role: string): Promise<void> {
    try {
      await api(`/system/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      load();
    } catch (e) {
      window.alert(`Could not change role: ${(e as Error).message}`);
    }
  }

  async function toggleActive(u: User): Promise<void> {
    try {
      await api(`/system/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !u.is_active }) });
      load();
    } catch (e) {
      window.alert(`Could not update user: ${(e as Error).message}`);
    }
  }

  async function doResetPw(u: User): Promise<void> {
    const ok = window.confirm(`Reset password for ${u.email}? The old password stops working immediately. The new one is shown once.`);
    if (!ok) return;
    try {
      const r = await api<{ email: string; password: string }>(`/system/users/${u.id}/reset-password`, { method: 'POST' });
      setResetPw(r);
    } catch (e) {
      window.alert(`Could not reset password: ${(e as Error).message}`);
    }
  }

  async function removeUser(u: User): Promise<void> {
    const ok = window.confirm(`Delete user ${u.email} (${u.role})? They lose access immediately. This cannot be undone.`);
    if (!ok) return;
    try {
      await api(`/system/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      window.alert(`Could not delete user: ${(e as Error).message}`);
    }
  }

  function copyIssued(): void {
    if (!issued) return;
    const msg = `Your 8xtelSMPP console login is ready.\nSign in: ${location.origin}/login\nEmail: ${issued.email}\nPassword: ${issued.password}\nRole: ${issued.user.role}`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users & roles"
        sub={`${users.length} console users · any email can be invited with any role`}
        actions={<button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add user</button>}
      />

      {/* role legend */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {(roles.length ? roles : Object.keys(ROLE_BLURB).map((name) => ({ id: name, name, description: null }))).map((r) => (
          <div key={r.name} className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <div className="font-mono text-[12px] font-semibold text-sky-300">{r.name}</div>
            <div className="text-[11px] text-muted mt-0.5">{r.description ?? ROLE_BLURB[r.name] ?? ''}</div>
          </div>
        ))}
      </div>

      {/* handoff card */}
      {issued && (
        <div className="card card-pad border-brand/40" style={{ boxShadow: '0 0 0 1px rgba(16,185,129,.35)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <Icon name="check" size={15} /> {issued.email} created — send them this login
            </div>
            <div className="flex gap-2">
              <button className="btn !py-1.5 !text-xs" onClick={copyIssued}>
                {copied ? 'Copied ✓' : 'Copy login message'}
              </button>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setIssued(null)}>Dismiss</button>
            </div>
          </div>
          <p className="text-xs text-muted mt-1 mb-3">
            Password is shown <b>once</b> — it is stored hashed and can never be retrieved again (only reset).
          </p>
          <div className="rounded-lg bg-ink border border-line p-3.5 font-mono text-[13px] leading-relaxed space-y-1 max-w-xl">
            <div className="flex justify-between gap-2"><span className="text-muted">Sign in</span><span>{location.origin}/login</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted">Email</span><span className="text-sky-300">{issued.email}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted">Password</span><span className="text-amber-300 select-all">{issued.password}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted">Role</span><span>{issued.user.role}</span></div>
          </div>
        </div>
      )}

      {users.length ? (
        <DataTable
          keyOf={(u) => u.id}
          rows={users}
          columns={[
            {
              key: 'email', label: 'User',
              render: (u) => (
                <div>
                  <div className="font-semibold">{u.email}</div>
                  <div className="text-[11px] text-muted">{u.full_name ?? '—'}</div>
                </div>
              ),
            },
            {
              key: 'role', label: 'Role',
              render: (u) => (
                <select className="input !py-1.5 !text-xs font-mono max-w-[160px]"
                  value={u.role} onChange={(e) => setRole(u, e.target.value)}
                  title={ROLE_BLURB[u.role] ?? u.role}>
                  {(roles.length ? roles.map((r) => r.name) : Object.keys(ROLE_BLURB)).map((rn) => (
                    <option key={rn} value={rn}>{rn}</option>
                  ))}
                </select>
              ),
            },
            {
              key: 'is_active', label: 'Status',
              render: (u) => <StatusBadge status={u.is_active ? 'active' : 'disabled'} />,
            },
            {
              key: 'last_login_at', label: 'Last login',
              render: (u) => (
                <span className="text-xs text-muted whitespace-nowrap">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}
                </span>
              ),
            },
            {
              key: 'actions', label: 'Actions',
              render: (u) => (
                <span className="flex gap-1">
                  <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:text-white hover:border-brand/40"
                    onClick={() => toggleActive(u)}>
                    {u.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-muted hover:text-white hover:border-brand/40"
                    onClick={() => doResetPw(u)}>
                    reset pw
                  </button>
                  <button className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line text-red-300/80 hover:text-red-200 hover:border-danger/50"
                    onClick={() => removeUser(u)}>
                    <Icon name="trash" size={12} />
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState icon="users" title="No users yet"
          sub="Invite the first team member — any email, any role."
          action={<button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add user</button>} />
      )}

      {show && (
        <Modal title="Add user" onClose={() => setShow(false)}>
          <form onSubmit={create} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div>
              <label className="label">Email (login) *</label>
              <input className="input" type="email" placeholder="ops@company.com" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="label">Full name</label>
              <input className="input" placeholder="Ops Engineer" value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <label className="label">Role *</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(roles.length ? roles.map((r) => r.name) : Object.keys(ROLE_BLURB)).map((rn) => (
                  <button key={rn} type="button" onClick={() => setForm({ ...form, role: rn })}
                    title={ROLE_BLURB[rn] ?? ''}
                    className={`rounded-lg border px-2.5 py-2 text-left transition ${form.role === rn
                      ? 'border-brand/50 bg-brand/10 text-emerald-300'
                      : 'border-line text-muted hover:text-white'}`}>
                    <div className="text-xs font-semibold font-mono">{rn}</div>
                    <div className="text-[10px] opacity-80 mt-0.5 leading-tight">{ROLE_BLURB[rn] ?? ''}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Password</label>
              <div className="flex gap-1.5 mb-2">
                {(['generate', 'manual'] as const).map((m) => (
                  <button key={m} type="button"
                    onClick={() => setForm({ ...form, passwordMode: m, password: m === 'generate' ? randomPassword() : form.password })}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${form.passwordMode === m
                      ? 'border-brand/50 text-emerald-300 bg-brand/10'
                      : 'border-line text-muted hover:text-white'}`}>
                    {m === 'generate' ? '⚄ Auto-generate' : '✎ Set manually'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <input
                  className="input font-mono !pr-20"
                  type={form.showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  readOnly={form.passwordMode === 'generate'}
                  minLength={8} required
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  <button type="button" className="text-[11px] text-muted hover:text-white px-1.5 py-1"
                    onClick={() => setForm({ ...form, showPw: !form.showPw })}>
                    {form.showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted mt-1">Min 8 chars · shown once after creation, then only a hash is stored.</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn flex-1" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
              <button className="btn-ghost" type="button" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {resetPw && (
        <Modal title={`New password — ${resetPw.email}`} onClose={() => setResetPw(null)}>
          <p className="text-xs text-muted mb-3">Copy now — it cannot be retrieved again. The old password is already revoked.</p>
          <div className="rounded-lg bg-ink border border-line p-3.5 font-mono text-[13px]">
            <div className="flex justify-between gap-2"><span className="text-muted">Password</span><span className="text-amber-300 select-all">{resetPw.password}</span></div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn flex-1" onClick={() => {
              navigator.clipboard.writeText(`Sign in at ${location.origin}/login\nEmail: ${resetPw.email}\nPassword: ${resetPw.password}`).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}>
              {copied ? 'Copied ✓' : 'Copy login message'}
            </button>
            <button className="btn-ghost" onClick={() => setResetPw(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
