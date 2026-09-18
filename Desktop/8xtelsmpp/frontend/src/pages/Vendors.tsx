import { useEffect, useRef, useState } from 'react';
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
  status: string; tps: number; protocol?: string; bind_type?: string; connection_count?: number;
  reconnect_interval_sec?: number; sender_id_rule?: string; use_tls?: boolean;
  connections: Conn[] | null;
}

const EMPTY_FORM = {
  name: '', host: '', port: '2775', system_id: '', password: '', tps: '50', protocol: 'smpp',
  bind_type: 'transceiver', connection_count: '1',
  // HTTP API fields (only used when protocol=http)
  http_url: '', http_method: 'POST', http_body: '', http_headers: '', http_msgid: '',
};
const EMPTY_HTTP = { http_url: '', http_method: 'POST', http_body: '', http_headers: '', http_msgid: '' };

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
      tps: String(v.tps ?? 50), protocol: v.protocol ?? 'smpp', bind_type: v.bind_type ?? 'transceiver',
      connection_count: String(v.connection_count ?? 1),
      ...EMPTY_HTTP,
    });
    setFormErr('');
    setShow(true);
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setFormErr('');
    try {
      const isHttp = form.protocol === 'http';
      if (editing) {
        const body: Record<string, unknown> = {
          name: form.name, host: form.host, port: Number(form.port),
          system_id: form.system_id, tps: Math.max(1, Number(form.tps) || 50),
          protocol: form.protocol,
          bind_type: form.bind_type, connection_count: Math.min(16, Math.max(1, Number(form.connection_count) || 1)),
        };
        if (form.password) body.password = form.password; // blank = keep existing
        await api(`/vendors/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        if (isHttp) await saveHttpConfig(editing.id);
      } else {
        // HTTP vendors: host/port/system_id are display-only — auto-fill so
        // the operator is never asked for SMPP fields they don't have.
        const payload: Record<string, unknown> = {
          name: form.name,
          host: isHttp ? (form.host || 'api') : form.host,
          port: isHttp ? 443 : Number(form.port),
          system_id: isHttp ? (form.system_id || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) : form.system_id,
          password: isHttp ? (form.password || 'http-vendor-no-smpp-login') : form.password,
          tps: Math.max(1, Number(form.tps) || 50),
          protocol: form.protocol,
          bind_type: form.bind_type,
          connection_count: 1,
          status: 'enabled',
        };
        const r = await api<{ vendor: { id: string } }>('/vendors', {
          method: 'POST', body: JSON.stringify(payload),
        });
        if (isHttp) await saveHttpConfig(r.vendor.id);
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

  /** Persist the inline HTTP config (create + edit). Throws with a readable
      message so save() shows it in the form error box. */
  async function saveHttpConfig(vendorId: string): Promise<void> {
    if (!form.http_url.trim()) throw new Error('Send URL is required for HTTP vendors.');
    let headers: Record<string, string> | null = null;
    if (form.http_headers.trim()) {
      try {
        headers = JSON.parse(form.http_headers) as Record<string, string>;
      } catch {
        throw new Error('Headers must be valid JSON, e.g. {"Authorization":"Bearer xxx"}');
      }
    }
    await api(`/vendors/${vendorId}/http`, {
      method: 'PUT',
      body: JSON.stringify({
        url_template: form.http_url.trim(),
        method: form.http_method,
        body_template: form.http_body.trim() || null,
        headers,
        msgid_json_path: form.http_msgid.trim() || null,
      }),
    });
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
                      <div className="font-semibold leading-tight flex items-center gap-1.5">
                        {v.name}
                        {(v.protocol ?? 'smpp') === 'http' && (
                          <span className="text-[10px] font-mono font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded px-1.5 py-0.5">HTTP</span>
                        )}
                      </div>
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
              <div className="col-span-2">
                <label className="label">Protocol</label>
                <div className="flex gap-1.5">
                  {(['smpp', 'http'] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setForm({ ...form, protocol: p })}
                      className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition ${form.protocol === p
                        ? 'border-brand/50 bg-brand/10 text-emerald-300'
                        : 'border-line text-muted hover:text-white'}`}>
                      {p === 'smpp' ? 'SMPP bind' : 'HTTP API'}
                    </button>
                  ))}
                </div>
              </div>
              {form.protocol === 'smpp' ? (
                <>
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
                    <label className="label">Connections <span className="text-gray-600">(parallel binds · 1–16)</span></label>
                    <input className="input font-mono max-w-[120px]" value={form.connection_count}
                      onChange={(e) => setForm({ ...form, connection_count: e.target.value })} inputMode="numeric" />
                  </div>
                </>
              ) : (
                <>
                  <div className="col-span-2">
                    <label className="label">Send URL <span className="text-gray-600">(their API endpoint + your key)</span></label>
                    <input className="input font-mono text-xs" placeholder="https://vendor.com/api/send?key=XXX&to={to}&text={text}"
                      value={form.http_url} onChange={(e) => setForm({ ...form, http_url: e.target.value })} required />
                    <p className="text-[11px] text-muted mt-1">Placeholders: {'{to} {from} {text} {msg_id} {dlr_url}'}</p>
                  </div>
                  <div>
                    <label className="label">Method</label>
                    <select className="input" value={form.http_method} onChange={(e) => setForm({ ...form, http_method: e.target.value })}>
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">TPS <span className="text-gray-600">(their limit)</span></label>
                    <input className="input font-mono" value={form.tps}
                      onChange={(e) => setForm({ ...form, tps: e.target.value })} inputMode="numeric" />
                  </div>
                  <div className="col-span-2">
                    <label className="label">POST body <span className="text-gray-600">(JSON · blank for GET-style)</span></label>
                    <textarea className="input font-mono text-xs" rows={2}
                      placeholder={'{"to":"{to}","text":"{text}","callback":"{dlr_url}"}'}
                      value={form.http_body} onChange={(e) => setForm({ ...form, http_body: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Headers <span className="text-gray-600">(JSON · e.g. API key)</span></label>
                    <input className="input font-mono text-xs" placeholder='{"Authorization":"Bearer xxx"}'
                      value={form.http_headers} onChange={(e) => setForm({ ...form, http_headers: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Message-ID path <span className="text-gray-600">(in their response)</span></label>
                    <input className="input font-mono text-xs" placeholder="message_id"
                      value={form.http_msgid} onChange={(e) => setForm({ ...form, http_msgid: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <p className="text-[11px] text-muted">
              {form.protocol === 'smpp'
                ? 'Password is encrypted at rest (AES-256-GCM) and never appears in logs.'
                : 'One HTTPS request per SMS — no SMPP bind. DLR webhook token is generated after creation (Edit → Inbound DLR webhook).'}
            </p>
            <div className="flex gap-2">
              <button className="btn flex-1" type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create & connect'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setShow(false)}>Cancel</button>
            </div>
          </form>
          {editing && (editing.protocol ?? 'smpp') === 'http' && (
            <div className="mt-4 pt-4 border-t border-line">
              <HttpConfigEditor vendorId={editing.id} />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ── HTTP vendor config editor (URL template, headers, DLR webhook tokens) ────
// Rendered inside the edit modal for protocol=http vendors only.
function HttpConfigEditor({ vendorId }: { vendorId: string }): JSX.Element {
  const [cfg, setCfg] = useState({
    url_template: '', method: 'POST', body_template: '',
    headers: '', msgid_json_path: '', timeout_ms: '10000',
    dlr_poll_url_template: '', dlr_poll_interval_sec: '30',
  });
  const [hasHeaders, setHasHeaders] = useState(false);
  const [tokens, setTokens] = useState<Array<{ id: string; label: string | null; created_at: string }>>([]);
  const [newToken, setNewToken] = useState<{ token: string; url: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [senderCount, setSenderCount] = useState(0);

  const loadAll = (): void => {
    api<{ http: Record<string, unknown> }>(`/vendors/${vendorId}/http`)
      .then((r) => {
        const h = r.http;
        setCfg({
          url_template: String(h.url_template ?? ''),
          method: String(h.method ?? 'POST'),
          body_template: String(h.body_template ?? ''),
          headers: '',
          msgid_json_path: String(h.msgid_json_path ?? ''),
          timeout_ms: String(h.timeout_ms ?? '10000'),
          dlr_poll_url_template: String(h.dlr_poll_url_template ?? ''),
          dlr_poll_interval_sec: String(h.dlr_poll_interval_sec ?? '30'),
        });
        setHasHeaders(Boolean(h.has_headers));
      })
      .catch(() => undefined);
    api<{ tokens: Array<{ id: string; label: string | null; created_at: string }> }>(`/vendors/${vendorId}/dlr-tokens`)
      .then((r) => setTokens(r.tokens))
      .catch(() => undefined);
    api<{ templates: Array<{ id: string }> }>(`/vendors/${vendorId}/sender-templates`)
      .then((r) => setSenderCount(r.templates.length))
      .catch(() => undefined);
  };
  useEffect(loadAll, [vendorId]);

  async function saveCfg(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      let headers: Record<string, string> | null = null;
      if (cfg.headers.trim()) {
        try {
          headers = JSON.parse(cfg.headers) as Record<string, string>;
        } catch {
          setMsg('Headers must be valid JSON, e.g. {"Authorization":"Bearer xxx"}');
          setBusy(false);
          return;
        }
      }
      await api(`/vendors/${vendorId}/http`, {
        method: 'PUT',
        body: JSON.stringify({
          url_template: cfg.url_template,
          method: cfg.method,
          body_template: cfg.body_template || null,
          headers,
          msgid_json_path: cfg.msgid_json_path || null,
          timeout_ms: Math.min(60000, Math.max(1000, Number(cfg.timeout_ms) || 10000)),
          dlr_poll_url_template: cfg.dlr_poll_url_template.trim() || null,
          dlr_poll_interval_sec: Math.min(600, Math.max(10, Number(cfg.dlr_poll_interval_sec) || 30)),
        }),
      });
      setCfg({ ...cfg, headers: '' });
      setMsg('Saved ✓');
      loadAll();
    } catch (e) {
      setMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createToken(): Promise<void> {
    setMsg('');
    try {
      const r = await api<{ id: string; token: string; url: string }>(`/vendors/${vendorId}/dlr-tokens`, {
        method: 'POST', body: JSON.stringify({ label: 'webhook' }),
      });
      setNewToken({ token: r.token, url: r.url });
      loadAll();
    } catch (e) {
      setMsg(`Token failed: ${(e as Error).message}`);
    }
  }

  async function deleteToken(id: string): Promise<void> {
    if (!window.confirm('Revoke this webhook token? The vendor URL using it stops working.')) return;
    try {
      await api(`/vendors/${vendorId}/dlr-tokens/${id}`, { method: 'DELETE' });
      loadAll();
    } catch (e) {
      setMsg(`Revoke failed: ${(e as Error).message}`);
    }
  }

  // Multi-SID mode: when sender templates exist, the worker resolves {from}
  // from the picked template — a hardcoded SID left in the URL/body would
  // fight that. Detect it and offer a one-click swap to {from}.
  const sidParamMatch = cfg.url_template.match(/[?&](?:sendername|senderid|sender_id|sender|from|source|header)=([^&]*)/i);
  const hardcodedSid = sidParamMatch?.[1] && !sidParamMatch[1].includes('{') ? sidParamMatch[1] : null;
  const bodyHardcoded = senderCount > 0 && cfg.body_template
    ? cfg.body_template.match(/"(?:sendername|senderid|sender_id|sender|from|source|header)"\s*:\s*"([^"]*)"/i)?.[1] ?? null
    : null;
  const staleSid = senderCount > 0 ? (hardcodedSid ?? (bodyHardcoded && !bodyHardcoded.includes('{') ? bodyHardcoded : null)) : null;

  function useFromPlaceholder(): void {
    let url = cfg.url_template;
    if (hardcodedSid) {
      url = url.replace(
        /([?&](?:sendername|senderid|sender_id|sender|from|source|header)=)([^&]*)/i,
        '$1{from}',
      );
    }
    let body = cfg.body_template;
    if (body) {
      body = body.replace(
        /("(?:sendername|senderid|sender_id|sender|from|source|header)"\s*:\s*")[^"]*(")/gi,
        '$1{from}$2',
      );
    }
    setCfg({ ...cfg, url_template: url, body_template: body });
    setMsg('Swapped to {from} — save to apply ✓ (worker also overrides it live)');
  }

  return (
    <div className="space-y-3">
      <div className="card-title">HTTP send config</div>
      {staleSid && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs">
          <span className="text-amber-300 font-semibold">⚠️ Old SID “{staleSid}” is hardcoded</span>
          <span className="text-muted"> — traffic ignores your picked Sender ID template until this uses </span>
          <span className="font-mono text-white/90">{'{from}'}</span>
          <button type="button" className="btn-ghost !py-1 !px-2.5 !text-xs ml-2" onClick={useFromPlaceholder}>
            Use {'{from}'} instead
          </button>
        </div>
      )}
      <form onSubmit={saveCfg} className="space-y-3">
        <div>
          <label className="label">Send URL template</label>
          <input className="input font-mono text-xs" placeholder="https://vendor.com/api/send?to={to}&text={text}"
            value={cfg.url_template} onChange={(e) => setCfg({ ...cfg, url_template: e.target.value })} required />
          <p className="text-[11px] text-muted mt-1">Placeholders: {'{to} {from} {text} {msg_id} {dlr_url}'}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Method</label>
            <select className="input" value={cfg.method} onChange={(e) => setCfg({ ...cfg, method: e.target.value })}>
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
          <div>
            <label className="label">Timeout (ms)</label>
            <input className="input font-mono" value={cfg.timeout_ms}
              onChange={(e) => setCfg({ ...cfg, timeout_ms: e.target.value })} inputMode="numeric" />
          </div>
        </div>
        <div>
          <label className="label">POST body template <span className="text-gray-600">(JSON, same placeholders · blank for GET-style)</span></label>
          <textarea className="input font-mono text-xs" rows={3}
            placeholder={'{"to":"{to}","text":"{text}","callback":"{dlr_url}"}'}
            value={cfg.body_template} onChange={(e) => setCfg({ ...cfg, body_template: e.target.value })} />
        </div>
        <div>
          <label className="label">Headers <span className="text-gray-600">(JSON · blank = keep{hasHeaders ? ' existing' : ''})</span></label>
          <input className="input font-mono text-xs" placeholder='{"Authorization":"Bearer xxx"}'
            value={cfg.headers} onChange={(e) => setCfg({ ...cfg, headers: e.target.value })} />
        </div>
        <div>
          <label className="label">Message-ID path <span className="text-gray-600">(dot path in their JSON response, e.g. data.id)</span></label>
          <input className="input font-mono text-xs" placeholder="message_id"
            value={cfg.msgid_json_path} onChange={(e) => setCfg({ ...cfg, msgid_json_path: e.target.value })} />
        </div>
        <div>
          <label className="label">DLR poll URL <span className="text-gray-600">(pull-style vendors · blank = webhook only)</span></label>
          <input className="input font-mono text-xs" placeholder="https://vendor.com/dlr?apikey=XXX&msgid={msgid}&format=json"
            value={cfg.dlr_poll_url_template} onChange={(e) => setCfg({ ...cfg, dlr_poll_url_template: e.target.value })} />
          <p className="text-[11px] text-muted mt-1">Placeholders: {'{msgid} {to}'}</p>
        </div>
        <div>
          <label className="label">Poll interval (sec)</label>
          <input className="input font-mono max-w-[120px]" value={cfg.dlr_poll_interval_sec}
            onChange={(e) => setCfg({ ...cfg, dlr_poll_interval_sec: e.target.value })} inputMode="numeric" />
        </div>
        <SenderTemplates vendorId={vendorId} />
        {msg && <div className="text-xs text-muted">{msg}</div>}
        <button className="btn !py-2" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save HTTP config'}</button>
      </form>

      <div className="pt-2">
        <div className="card-title mb-2">Inbound DLR webhook</div>
        <p className="text-[11px] text-muted mb-2">Give the vendor this URL — they POST {'{message_id, status}'} and DLRs flow into the normal pipeline.</p>
        {newToken && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 mb-2">
            <div className="text-[11px] text-emerald-300 font-semibold mb-1">New token — copy now, shown once:</div>
            <div className="font-mono text-xs break-all select-all">{newToken.url}</div>
          </div>
        )}
        {tokens.map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-xs font-mono py-1">
            <span className="text-muted">{t.label ?? 'token'} · {new Date(t.created_at).toLocaleDateString()}</span>
            <button className="btn-ghost !py-0.5 !px-2 !text-[11px] text-red-300 ml-auto" onClick={() => void deleteToken(t.id)}>Revoke</button>
          </div>
        ))}
        <button className="btn-ghost !py-1.5 !text-xs mt-1" onClick={() => void createToken()}>+ New webhook token</button>
      </div>
    </div>
  );
}

// ── Per-SID templates (one row per approved Sender ID + its DLT template) ───
// At send time the worker matches the client sender; on no match the default
// row wins so the vendor always sees an approved SID + matching template.
interface SenderTpl {
  id: string;
  sender_id: string;
  template: string;
  is_default: boolean;
}

function SenderTemplates({ vendorId }: { vendorId: string }): JSX.Element {
  const [rows, setRows] = useState<SenderTpl[]>([]);
  const [sid, setSid] = useState('');
  const [tpl, setTpl] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Inline edit state: which row is being edited + its draft values
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTpl, setEditTpl] = useState('');
  const [editDefault, setEditDefault] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const sidRef = useRef<HTMLInputElement>(null);

  const load = (): void => {
    api<{ templates: SenderTpl[] }>(`/vendors/${vendorId}/sender-templates`)
      .then((r) => setRows(r.templates))
      .catch(() => undefined);
  };
  useEffect(load, [vendorId]);

  async function saveRow(senderId: string, template: string, makeDefault: boolean): Promise<void> {
    await api(`/vendors/${vendorId}/sender-templates`, {
      method: 'POST',
      body: JSON.stringify({ sender_id: senderId.trim(), template: template.trim(), is_default: makeDefault }),
    });
    load();
  }

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!sid.trim() || !tpl.trim()) {
      setMsg('Sender ID and template are both required.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      await saveRow(sid, tpl, isDefault);
      setSid('');
      setTpl('');
      setIsDefault(false);
      setMsg('Saved ✓ — add the next SID below');
      sidRef.current?.focus(); // stay in flow for rapid multi-SID entry
    } catch (e) {
      setMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: SenderTpl): void {
    setEditingId(r.id);
    setEditTpl(r.template);
    setEditDefault(r.is_default);
    setMsg('');
  }

  async function saveEdit(r: SenderTpl): Promise<void> {
    if (!editTpl.trim()) {
      setMsg('Template cannot be empty.');
      return;
    }
    setEditBusy(true);
    setMsg('');
    try {
      await saveRow(r.sender_id, editTpl, editDefault);
      setEditingId(null);
      setMsg(`Updated ${r.sender_id} ✓`);
    } catch (e) {
      setMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setEditBusy(false);
    }
  }

  async function remove(id: string, senderId: string): Promise<void> {
    if (!window.confirm(`Delete template for sender "${senderId}"? Messages with that sender fall back to the default row.`)) return;
    try {
      await api(`/vendors/${vendorId}/sender-templates/${id}`, { method: 'DELETE' });
      if (editingId === id) setEditingId(null);
      load();
    } catch (e) {
      setMsg(`Delete failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5 space-y-3">
      <div className="card-title">
        Sender IDs + templates{' '}
        <span className="text-gray-600 font-normal">(matched by client sender · default wins on no match)</span>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg bg-ink/60 border border-line/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">{r.sender_id}</span>
                {r.is_default && (
                  <span className="text-[10px] font-semibold bg-brand/15 text-emerald-300 border border-brand/30 rounded px-1.5 py-0.5">DEFAULT</span>
                )}
                {editingId === r.id ? (
                  <span className="flex items-center gap-1.5 ml-auto">
                    <button className="btn !py-0.5 !px-2.5 !text-[11px]" disabled={editBusy}
                      onClick={() => void saveEdit(r)}>{editBusy ? 'Saving…' : 'Save'}</button>
                    <button className="btn-ghost !py-0.5 !px-2 !text-[11px]" disabled={editBusy}
                      onClick={() => setEditingId(null)}>Cancel</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 ml-auto">
                    <button className="btn-ghost !py-0.5 !px-2 !text-[11px]"
                      onClick={() => startEdit(r)}>Edit</button>
                    <button className="btn-ghost !py-0.5 !px-2 !text-[11px] text-red-300"
                      onClick={() => void remove(r.id, r.sender_id)}>Delete</button>
                  </span>
                )}
              </div>
              {editingId === r.id ? (
                <div className="mt-2 space-y-2">
                  <textarea className="input font-mono text-xs" rows={2} value={editTpl}
                    onChange={(e) => setEditTpl(e.target.value)} />
                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                    <input type="checkbox" checked={editDefault} onChange={(e) => setEditDefault(e.target.checked)} />
                    Default (used when sender matches nothing)
                  </label>
                </div>
              ) : (
                <div className="text-[11px] text-muted font-mono mt-1 break-words">{r.template}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted">No sender templates yet — add one per approved Sender ID below.</p>
      )}
      <form onSubmit={add} className="space-y-2 pt-1 border-t border-line/60">
        <div className="grid grid-cols-[140px_1fr] gap-2 pt-2">
          <input ref={sidRef} className="input font-mono text-xs" placeholder="Sender ID, e.g. PKSSSL"
            value={sid} onChange={(e) => setSid(e.target.value)} maxLength={21} />
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Default (used when sender matches nothing)
          </label>
        </div>
        <textarea className="input font-mono text-xs" rows={2}
          placeholder="Template with {v1} {v2} … e.g. Dear user refund of Rs.{v1} processed. Claim: {v2}"
          value={tpl} onChange={(e) => setTpl(e.target.value)} />
        <p className="text-[11px] text-muted">
          Client sends vars joined by <span className="font-mono">|</span>, e.g. <span className="font-mono">500|ln.run/Ya19A</span> → fills {'{v1} {v2}'} in order.
        </p>
        {msg && <div className="text-xs text-muted">{msg}</div>}
        <button className="btn !py-1.5 !text-xs" type="submit" disabled={busy}>
          {busy ? 'Saving…' : '+ Add sender template'}
        </button>
      </form>
    </div>
  );
}
