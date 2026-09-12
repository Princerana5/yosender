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
  status: string; tps: number; connections: Conn[] | null;
}

export default function Vendors(): JSX.Element {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState({ name: '', host: '', port: '2775', system_id: '', password: '' });

  const load = (): void => {
    api<{ vendors: Vendor[] }>('/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormErr('');
    try {
      await api('/vendors', {
        method: 'POST',
        body: JSON.stringify({ ...form, port: Number(form.port), status: 'enabled' }),
      });
      setShow(false);
      setForm({ name: '', host: '', port: '2775', system_id: '', password: '' });
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendors"
        sub={`${vendors.length} upstream SMSCs · auto-reconnect with backoff`}
        actions={<button className="btn" onClick={() => setShow(true)}><Icon name="plus" size={14} /> Add vendor</button>}
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
                      <div className="text-[11px] text-muted font-mono">{v.host}:{v.port} · {v.system_id}</div>
                    </div>
                  </div>
                  <StatusBadge status={main} />
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
                  <div className="text-xs text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-2.5 py-1.5 mt-3 font-mono truncate">
                    {conns[0].last_error}
                  </div>
                )}
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
        <Modal title="New upstream vendor" onClose={() => setShow(false)}>
          <form onSubmit={create} className="space-y-4">
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
                <label className="label">Password</label>
                <input className="input" type="password" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </div>
            </div>
            <p className="text-[11px] text-muted">Password is encrypted at rest (AES-256-GCM) and never appears in logs.</p>
            <div className="flex gap-2">
              <button className="btn flex-1" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Create & connect'}</button>
              <button className="btn-ghost" type="button" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
