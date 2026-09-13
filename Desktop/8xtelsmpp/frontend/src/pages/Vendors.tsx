import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, StatusBadge, Modal, EmptyState, Icon } from '../components';

interface Conn {
  status: string;
  messages_sent: string;
  messages_received: string;
  dlr_count: string;
  last_error: string | null;
  connected_since: string | null;
}

interface Vendor {
  id: string; name: string; host: string; port: number; system_id: string;
  status: string; tps: number; bind_type?: string; connection_count?: number;
  reconnect_interval_sec?: number; sender_id_rule?: string; use_tls?: boolean;
  connections: Conn[] | null;
}

const EMPTY_FORM = { name: '', host: '', port: '2775', system_id: '', password: '', tps: '50', bind_type: 'transceiver', connection_count: '1' };

export default function Vendors(): JSX.Element {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [copied, setCopied] = useState('');

  const load = (): void => {
    api<{ vendors: Vendor[] }>('/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  function openCreate(): void {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErr('');
    setShow(true);
  }

  function openEdit(v: Vendor): void {
    setEditing(v);
    setForm({
      name: v.name, host: v.host, port: String(v.port), system_id: v.system_id, password: '',
      tps: String(v.tps ?? 50), bind_type: v.bind_type ?? 'transceiver',
      connection_count: String(v.connection_count ?? 1),
    });
    setFormErr('');
    setShow(true);
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormErr('');
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          name: form.name, host: form.host, port: Number(form.port),
          system_id: form.system_id, tps: Math.max(1, Number(form.tps) || 50),
          bind_type: form.bind_type, connection_count: Math.min(8, Math.max(1, Number(form.connection_count) || 1)),
        };
        if (form.password) body.password = form.password; // blank = keep existing
        await api(`/vendors/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/vendors', {
          method: 'POST',
          body: JSON.stringify({
            ...form, port: Number(form.port),
            tps: Math.max(1, Number(form.tps) || 50),
            connection_count: Math.min(8, Math.max(1, Number(form.connection_count) || 1)),
            status: 'enabled',
          }),
        });
      }
      setShow(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(v: Vendor): Promise<void> {
    try {
      await api(`/vendors/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: v.status === 'enabled' ? 'disabled' : 'enabled' }),
      });
      load();
    } catch (e) {
      window.alert(`Could not update vendor: ${(e as Error).message}`);
    }
  }

  async function removeVendor(v: Vendor): Promise<void> {
    const ok = window.confirm(
      `Delete vendor "${v.name}" (${v.host}:${v.port})?\n\nRoutes using it lose this hop. Message history is kept (detached). This cannot be undone.\n\nType DELETE in the next prompt to confirm.`,
    );
    if (!ok) return;
    const typed = window.prompt(`Confirm delete — type DELETE to remove "${v.name}":`);
    if (typed !== 'DELETE') return;
    try {
      await api(`/vendors/${v.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      window.alert(`Could not delete vendor: ${(e as Error).message}`);
    }
  }

  function copyStatus(v: Vendor): void {
    const conns = v.connections ?? [];
    const lines = conns.length
      ? conns.map((c, i) => `  bind #${i} — ${c.status}${c.last_error ? ` (${c.last_error})` : ''} · sent ${c.messages_sent} · recv ${c.messages_received} · dlr ${c.dlr_count}`).join('\n')
      : '  no binds yet';
    const msg =
      `Vendor: ${v.name} (${v.host}:${v.port} · ${v.system_id} · ${v.bind_type ?? 'transceiver'})\n` +
      `Status: ${v.status}\n${lines}`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(v.id);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendors"
        sub={`${vendors.length} upstream SMSCs · auto-reconnect with backoff`}
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={14} /> Add vendor</button>}
      />

      {vendors.length ? (
        <div className="grid md:grid-cols-2 gap-3">
          {vendors.map((v) => {
            const conns = v.connections ?? [];
            const sent = conns.reduce((s, c) => s + Number(c.messages_sent), 0);
            const recv = conns.reduce((s, c) => s + Number(c.messages_received), 0);
            const dlrs = conns.reduce((s, c) => s + Number(c.dlr_count), 0);
            const main = conns[0]?.status ?? v.status;
            return (
              <div key={v.id} className="card card-pad">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-panel2 border border-line flex items-center justify-center text-muted">
                      <Icon name="server" size={17} />
                    </div>
                    <div>
                      <div className="font-semibold leading-tight">{v.name}</div>
                      <div className="text-[11px] text-muted font-mono">{v.host}:{v.port} · {v.system_id} · {v.bind_type ?? 'transceiver'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={main} />
                    <button className="btn-ghost !px-2 !py-1 !text-xs" title={`Edit ${v.name}`} onClick={() => openEdit(v)}>
                      Edit
                    </button>
                    <button className="btn-ghost !px-2 !py-1 !text-xs text-red-300 hover:text-red-200" title={`Delete ${v.name}`} onClick={() => removeVendor(v)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-4 text-center">
                  {[
                    ['Sent', sent],
                    ['Recv', recv],
                    ['DLRs', dlrs],
                    ['TPS', v.tps],
                  ].map(([l, n]) => (
                    <div key={l as string} className="rounded-lg bg-ink/60 border border-line/60 py-2">
                      <div className="font-bold tabular-nums">{(n as number).toLocaleString()}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted">{l}</div>
                    </div>
                  ))}
                </div>
                {conns[0]?.last_error && (
                  <div className="text-xs text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-2.5 py-1.5 mt-3 font-mono truncate" title={conns[0].last_error}>
                    {conns[0].last_error}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-3">
                  <button className={`btn-ghost !py-1 !px-2.5 !text-xs ${v.status === 'enabled' ? '' : '!border-brand/40 !text-emerald-300'}`}
                    onClick={() => toggleStatus(v)}>
                    {v.status === 'enabled' ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn-ghost !py-1 !px-2.5 !text-xs ml-auto" onClick={() => copyStatus(v)}>
                    {copied === v.id ? 'Copied ✓' : 'Copy status'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="server" title="No vendors connected"
          sub="Add your first upstream SMSC to start terminating traffic."
          action={<button className="btn" onClick={() => setShow(true)}><Icon name="plus" size={14} /> Add vendor</button>} />
      )}

      {show && (
        <Modal title={editing ? `Edit vendor — ${editing.name}` : 'New upstream vendor'} onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Vendor name</label>
                <input className="input" placeholder="Vendor A — India" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="label">Host</label>
                <input className="input font-mono" placeholder="smpp.vendor.com" value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })} required />
              </div>
              <div>
                <label className="label">Port</label>
                <input className="input font-mono" value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })} required />
              </div>
              <div>
                <label className="label">System ID</label>
                <input className="input font-mono" value={form.system_id}
                  onChange={(e) => setForm({ ...form, system_id: e.target.value })} required />
              </div>
              <div>
                <label className="label">Password {editing && <span className="text-gray-600">(blank = keep)</span>}</label>
                <input className="input" type="password" value={form.password}
                  placeholder={editing ? '••••••••' : ''}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} />
              </div>
              <div>
                <label className="label">Bind type</label>
                <div className="flex gap-1.5">
                  {(['transceiver', 'transmitter', 'receiver'] as const).map((b) => (
                    <button key={b} type="button" onClick={() => setForm({ ...form, bind_type: b })}
                      className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition ${form.bind_type === b
                        ? 'border-brand/50 bg-brand/10 text-emerald-300'
                        : 'border-line text-muted hover:text-white'}`}>
                      {b === 'transceiver' ? 'TRX' : b === 'transmitter' ? 'TX' : 'RX'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">TPS</label>
                <input className="input font-mono" value={form.tps}
                  onChange={(e) => setForm({ ...form, tps: e.target.value })} inputMode="numeric" />
              </div>
              <div className="col-span-2">
                <label className="label">Connections <span className="text-gray-600">(parallel binds · 1–8)</span></label>
                <input className="input font-mono max-w-[120px]" value={form.connection_count}
                  onChange={(e) => setForm({ ...form, connection_count: e.target.value })} inputMode="numeric" />
              </div>
            </div>
            <p className="text-[11px] text-muted">Password is encrypted at rest (AES-256-GCM) and never appears in logs.</p>
            <div className="flex gap-2">
              <button className="btn flex-1" type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create & connect'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
