import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, StatusBadge } from '../components';

interface ClientOpt {
  id: string;
  name: string;
  system_id: string;
  status: string;
  is_house?: boolean;
}

interface RouteOpt {
  id: string;
  name: string;
  strategy: string;
  status: string;
}

interface VendorOpt {
  id: string;
  name: string;
  status: string;
}

interface CountryOpt {
  id: string;
  name: string;
  iso_code: string;
  calling_code: string;
}

interface SendResult {
  id: string;
  client_msg_id: string;
  status: string;
}

interface MsgDetail {
  message: {
    id: string; status: string; vendor_msg_id: string | null;
    error_code: string | null; error_description: string | null;
    client_price: string | null; vendor_cost: string | null;
  };
  events: Array<{ event: string; detail: string | null; created_at: string }>;
  dlr: { vendor_status: string; client_status: string } | null;
}

const POLL_MS = 2000;

export default function SendSms(): JSX.Element {
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [routes, setRoutes] = useState<RouteOpt[]>([]);
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [countries, setCountries] = useState<CountryOpt[]>([]);
  const [clientId, setClientId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [source, setSource] = useState('8XTEL');
  const [destination, setDestination] = useState('');
  const [text, setText] = useState('Hello from 8xtelSMPP test');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<SendResult | null>(null);
  const [detail, setDetail] = useState<MsgDetail | null>(null);

  useEffect(() => {
    api<{ clients: ClientOpt[] }>('/clients')
      .then((r) => {
        setClients(r.clients);
        // Default to the house Main Account; fall back to first active client
        const house = r.clients.find((c) => c.is_house && c.status === 'active');
        const firstActive = r.clients.find((c) => c.status === 'active');
        if (house) setClientId(house.id);
        else if (firstActive) setClientId(firstActive.id);
      })
      .catch(() => undefined);
    api<{ routes: RouteOpt[] }>('/routes').then((r) => setRoutes(r.routes)).catch(() => undefined);
    api<{ vendors: VendorOpt[] }>('/vendors').then((r) => setVendors(r.vendors)).catch(() => undefined);
    api<{ countries: CountryOpt[] }>('/system/countries').then((r) => setCountries(r.countries)).catch(() => undefined);
  }, []);

  // Track the sent message until it reaches a terminal state
  useEffect(() => {
    if (!sent) return;
    let dead = false;
    const terminal = new Set(['delivered', 'undelivered', 'expired', 'rejected', 'failed']);
    const poll = (): void => {
      api<MsgDetail>(`/messages/${sent.id}`)
        .then((r) => {
          if (dead) return;
          setDetail(r);
          if (terminal.has(r.message.status)) {
            clearInterval(t);
          }
        })
        .catch(() => undefined);
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [sent]);

  const parts = Math.max(1, Math.ceil(text.length / 160));

  async function send(): Promise<void> {
    setErr('');
    setSent(null);
    setDetail(null);
    if (!clientId) {
      setErr('Pick a client first.');
      return;
    }
    setSending(true);
    try {
      const r = await api<SendResult>('/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          source,
          destination,
          text,
          route_id: routeId || null,
          vendor_id: vendorId || null,
        }),
      });
      setSent(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Send test SMS"
        sub="Inject a message as a client · same pipeline as SMPP submit (route → vendor → DLR → billing)"
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* form */}
        <div className="card card-pad space-y-4">
          <div>
            <label className="label">Send as <span className="text-muted font-normal">(billed account)</span></label>
            <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— select —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.is_house ? '🏠 ' : ''}{c.name} · {c.system_id}{c.status !== 'active' ? ` (${c.status})` : ''}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-muted mt-1">
              Test sends are billed to this account. 🏠 Main Account is the house account for console tests.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">From (sender ID)</label>
              <input className="input font-mono" value={source}
                onChange={(e) => setSource(e.target.value)} maxLength={21} placeholder="8XTEL" />
            </div>
            <div>
              <label className="label">To (destination)</label>
              <div className="flex gap-2">
                <input className="input font-mono flex-1" value={destination}
                  onChange={(e) => setDestination(e.target.value)} placeholder="919876543210" />
                <select
                  className="input !w-auto max-w-[140px]"
                  title="Prefix destination with country calling code"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setDestination(e.target.value);
                  }}
                >
                  <option value="">+code</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.calling_code}>
                      {c.iso_code} +{c.calling_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Route <span className="text-muted font-normal">(optional override)</span></label>
              <select className="input" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                <option value="">Auto — normal route matching</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.strategy}{r.status !== 'active' ? ` (${r.status})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Vendor <span className="text-muted font-normal">(optional override)</span></label>
              <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Auto — route's vendor chain</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.status !== 'enabled' ? ` (${v.status})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {(routeId || vendorId) && (
            <div className="text-xs text-amber-300 bg-warn/10 border border-warn/25 rounded-lg px-3 py-2">
              Forced path{routeId && vendorId ? ' — route + vendor' : routeId ? ' — route (its vendor chain still applies)' : ' — vendor only, no route matching'}
              . Block/reject filters still apply.
            </div>
          )}
          <div>
            <label className="label">Message</label>
            <textarea className="input min-h-[120px]" value={text}
              onChange={(e) => setText(e.target.value)} maxLength={2000} />
            <div className="flex justify-between text-[11px] text-muted mt-1 tabular-nums">
              <span>{text.length}/2000 chars · ~{parts} SMS part{parts > 1 ? 's' : ''}</span>
              <span>Billed + routed like real traffic</span>
            </div>
          </div>
          {err && (
            <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <button className="btn w-full" onClick={send} disabled={sending || !clientId || !destination || !text}>
            {sending ? 'Sending…' : '✉ Send test SMS'}
          </button>
        </div>

        {/* result / tracking */}
        <div className="card card-pad">
          <div className="card-title">Delivery tracking</div>
          <div className="card-sub">Live status · polls every 2s until terminal</div>
          {!sent && !err && (
            <div className="text-sm text-muted py-10 text-center">
              Send a message to watch it flow through routing → vendor → DLR here.
            </div>
          )}
          {sent && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={detail?.message.status ?? sent.status} />
                <span className="text-xs text-muted font-mono">{sent.id.slice(0, 8)}</span>
                <Link to={`/messages?message_id=${sent.id}`} className="text-xs text-brand hover:underline ml-auto">
                  Open in logs →
                </Link>
              </div>
              <div className="text-xs space-y-1.5 font-mono">
                <div className="flex justify-between"><span className="text-muted">vendor msg id</span><span>{detail?.message.vendor_msg_id ?? '…'}</span></div>
                <div className="flex justify-between"><span className="text-muted">price / cost</span><span>{detail?.message.client_price ?? '…'} / {detail?.message.vendor_cost ?? '…'}</span></div>
                {detail?.dlr && (
                  <div className="flex justify-between"><span className="text-muted">DLR</span><span>{detail.dlr.vendor_status} → {detail.dlr.client_status}</span></div>
                )}
                {detail?.message.error_description && (
                  <div className="text-red-300 break-all">{detail.message.error_description}</div>
                )}
              </div>
              {!!detail?.events.length && (
                <div>
                  <div className="stat-label mb-1.5">Pipeline trail</div>
                  <ol className="space-y-1.5">
                    {detail.events.map((e, i) => (
                      <li key={i} className="flex gap-2 text-xs">
                        <span className="text-muted font-mono whitespace-nowrap">
                          {new Date(e.created_at).toLocaleTimeString()}
                        </span>
                        <span className="font-semibold">{e.event}</span>
                        {e.detail && <span className="text-muted truncate" title={e.detail}>{e.detail}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="text-[11px] text-muted">
        Tip: watch it appear on <Link to="/traffic" className="text-brand hover:underline">Live traffic</Link> with
        content visible via 👁 Show content.
      </div>
    </div>
  );
}
