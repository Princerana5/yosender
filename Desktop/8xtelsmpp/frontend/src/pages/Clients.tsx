import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, SearchInput, Modal, EmptyState, Icon, Money } from '../components';

interface Client {
  id: string; name: string; company_name: string | null; system_id: string;
  status: string; balance: string; credit_limit: string; tps_limit: number; ip_count: string;
  is_house?: boolean;
}

interface Handoff {
  credentials: {
    system_id: string;
    password: string;
    password_mode: 'manual' | 'generated';
    host: string;
    port: number;
    bind_types: string[];
    enquire_link_sec: number;
  };
  handoff: {
    whitelisted_for_client: string[];
    whitelist_note: string;
    our_gateway: { ip: string; port: number; note: string };
    message: string;
  };
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

export default function Clients(): JSX.Element {
  const [clients, setClients] = useState<Client[]>([]);
  const [q, setQ] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState({
    name: '', system_id: '', password: '', passwordMode: 'generate' as 'generate' | 'manual',
    showPw: false, allowed_ips: '', currency: 'USD', tps_limit: '50',
  });
  const [created, setCreated] = useState<Handoff | null>(null);
  const [copied, setCopied] = useState(false);

  const load = (): void => {
    api<{ clients: Client[] }>(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setClients(r.clients))
      .catch(() => undefined);
  };
  useEffect(load, []);

  function openModal(): void {
    setForm({ name: '', system_id: '', password: randomPassword(), passwordMode: 'generate', showPw: false, allowed_ips: '', currency: 'USD', tps_limit: '50' });
    setFormErr('');
    setShow(true);
  }

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormErr('');
    try {
      const r = await api<Handoff>('/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          system_id: form.system_id,
          ...(form.passwordMode === 'manual' ? { password: form.password } : {}),
          status: 'active',
          currency: form.currency,
          tps_limit: Math.max(1, Number(form.tps_limit) || 50),
          allowed_ips: form.allowed_ips.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      setCreated(r);
      setShow(false);
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copyHandoff(): void {
    if (!created) return;
    navigator.clipboard.writeText(created.handoff.message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  async function removeClient(c: Client): Promise<void> {
    if (c.is_house) {
      window.alert('House accounts cannot be deleted.');
      return;
    }
    const ok = window.confirm(
      `Delete client "${c.name}" (${c.system_id})?\n\nWallet, ledger, IPs, rates and sender IDs are removed. Message history is kept (detached). This cannot be undone.\n\nType DELETE in the next prompt to confirm.`,
    );
    if (!ok) return;
    const typed = window.prompt(`Confirm delete — type DELETE to remove "${c.system_id}":`);
    if (typed !== 'DELETE') return;
    try {
      await api(`/clients/${c.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      window.alert(`Could not delete client: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        sub={`${clients.length} downstream accounts · SMPP binds on :2775`}
        actions={<button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add client</button>}
      />

      <SearchInput value={q} onChange={setQ} onSearch={load} placeholder="Search name, company or system ID…" />

      {/* ── Handoff card: shown ONCE after creation ── */}
      {created && (
        <div className="card card-pad border-brand/40" style={{ boxShadow: '0 0 0 1px rgba(16,185,129,.35)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <Icon name="check" size={15} /> Client created — send them this handoff
            </div>
            <div className="flex gap-2">
              <button className="btn !py-1.5 !text-xs" onClick={copyHandoff}>
                {copied ? 'Copied ✓' : 'Copy handoff message'}
              </button>
              <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setCreated(null)}>Dismiss</button>
            </div>
          </div>
          <p className="text-xs text-muted mt-1 mb-3">
            Password is shown <b>once</b> — it is stored hashed and can never be retrieved again (only rotated).
          </p>

          <div className="grid md:grid-cols-2 gap-3">
            {/* their credentials */}
            <div className="rounded-lg border border-line bg-ink/70 p-3.5">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">
                Their SMPP credentials — connect to us
              </div>
              <dl className="font-mono text-[13px] leading-relaxed space-y-1">
                <div className="flex justify-between gap-2"><dt className="text-muted">Host</dt><dd>{created.credentials.host}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted">Port</dt><dd>{created.credentials.port}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted">Username</dt><dd className="text-sky-300">{created.credentials.system_id}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted">Password</dt>
                  <dd className="text-amber-300 select-all">{created.credentials.password}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted">Bind</dt><dd className="text-xs">{created.credentials.bind_types.join(' / ')}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted">Enquire link</dt><dd>{created.credentials.enquire_link_sec}s</dd></div>
              </dl>
            </div>
            {/* IP exchange */}
            <div className="space-y-3">
              <div className="rounded-lg border border-brand/30 bg-brand/5 p-3.5">
                <div className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold mb-1">
                  ✓ We whitelisted their IP{created.handoff.whitelisted_for_client.length === 1 ? '' : 's'}
                </div>
                <div className="font-mono text-[13px]">
                  {created.handoff.whitelisted_for_client.length
                    ? created.handoff.whitelisted_for_client.join(', ')
                    : 'none — open to any IP'}
                </div>
                <div className="text-xs text-muted mt-1">{created.handoff.whitelist_note}</div>
              </div>
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3.5">
                <div className="text-[11px] uppercase tracking-wider text-sky-300 font-semibold mb-1">
                  → They must whitelist OUR gateway
                </div>
                <div className="font-mono text-[13px]">{created.handoff.our_gateway.ip}:{created.handoff.our_gateway.port}</div>
                <div className="text-xs text-muted mt-1">{created.handoff.our_gateway.note}</div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-line bg-ink/70 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Ready-to-send message</div>
            <pre className="text-[12px] font-mono whitespace-pre-wrap leading-relaxed text-gray-300">{created.handoff.message}</pre>
          </div>
        </div>
      )}

      {clients.length ? (
        <DataTable
          keyOf={(c) => c.id}
          rows={clients}
          columns={[
            {
              key: 'name', label: 'Client',
              render: (c) => (
                <div>
                  <Link className="font-semibold text-sky-300 hover:text-sky-200 hover:underline" to={`/clients/${c.id}`}>
                    {c.name}
                  </Link>
                  {c.is_house && (
                    <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-warn/15 text-amber-300 border border-warn/30 align-middle">
                      🏠 HOUSE
                    </span>
                  )}
                  <div className="text-[11px] text-muted">{c.company_name ?? '—'}</div>
                </div>
              ),
            },
            { key: 'system_id', label: 'System ID', mono: true },
            { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            { key: 'balance', label: 'Balance', right: true, render: (c) => <Money value={c.balance} /> },
            { key: 'credit_limit', label: 'Credit', right: true, render: (c) => <Money value={c.credit_limit} /> },
            { key: 'tps_limit', label: 'TPS', right: true, render: (c) => <span className="tabular-nums">{c.tps_limit}</span> },
            { key: 'ip_count', label: 'IPs', right: true, render: (c) => <span className="tabular-nums">{c.ip_count}</span> },
            {
              key: 'actions', label: '',
              render: (c) => (
                c.is_house ? <span className="text-[11px] text-muted">—</span> : (
                  <button className="btn-ghost !px-2 !py-1 text-red-300 hover:text-red-200"
                    title={`Delete client "${c.name}"`}
                    onClick={() => removeClient(c)}>
                    <Icon name="trash" size={14} />
                  </button>
                )
              ),
            },
          ]}
        />
      ) : (
        <EmptyState icon="users" title="No clients yet"
          sub="Create your first downstream account to issue SMPP credentials."
          action={<button className="btn" onClick={openModal}><Icon name="plus" size={14} /> Add client</button>} />
      )}

      {show && (
        <Modal title="New client" onClose={() => setShow(false)}>
          <form onSubmit={create} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div>
              <label className="label">Display name</label>
              <input className="input" placeholder="Acme Corp" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">System ID (SMPP username)</label>
              <input className="input font-mono" placeholder="client_001" value={form.system_id}
                onChange={(e) => setForm({ ...form, system_id: e.target.value })} required />
            </div>

            {/* password mode */}
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
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-1">
                  <button type="button" className="text-[11px] text-muted hover:text-white px-1.5 py-1"
                    onClick={() => setForm({ ...form, showPw: !form.showPw })}>
                    {form.showPw ? 'Hide' : 'Show'}
                  </button>
                  {form.passwordMode === 'generate' && (
                    <button type="button" className="text-[11px] text-brand hover:text-emerald-300 px-1.5 py-1 font-semibold"
                      onClick={() => setForm({ ...form, password: randomPassword() })}>
                      ↻ New
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted mt-1">Min 8 chars · shown once after creation, then only a hash is stored.</p>
            </div>

            <div>
              <label className="label">Wallet currency</label>
              <div className="flex gap-1.5">
                {(['USD', 'EUR', 'INR'] as const).map((cur) => (
                  <button key={cur} type="button" onClick={() => setForm({ ...form, currency: cur })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${form.currency === cur
                      ? 'border-brand/50 bg-brand/10 text-emerald-300'
                      : 'border-line text-muted hover:text-white'}`}>
                    {cur === 'USD' ? '$ USD' : cur === 'EUR' ? '€ EUR' : '₹ INR'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">TPS limit <span className="text-gray-600">(msgs/sec · default 50)</span></label>
                <input className="input font-mono" value={form.tps_limit}
                  onChange={(e) => setForm({ ...form, tps_limit: e.target.value })} inputMode="numeric" />
              </div>
              <div>
                <label className="label">Status</label>
                <div className="rounded-lg border border-line bg-ink/50 px-3 py-2.5 text-sm text-emerald-300 font-semibold">
                  active <span className="text-muted font-normal text-xs">· created ready to bind</span>
                </div>
              </div>
            </div>

            <div>
              <label className="label">Whitelist THEIR IPs <span className="text-gray-600">(comma separated · blank = any IP)</span></label>
              <input className="input font-mono" placeholder="103.20.10.5, 103.20.10.0/24" value={form.allowed_ips}
                onChange={(e) => setForm({ ...form, allowed_ips: e.target.value })} />
              <p className="text-[11px] text-muted mt-1">Binds from other IPs are rejected + logged. They must whitelist OUR gateway IP in return (shown after creation).</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn flex-1" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create & issue credentials'}</button>
              <button className="btn-ghost" type="button" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
