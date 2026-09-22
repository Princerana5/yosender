import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, StatusBadge } from '../components';

interface RnClient {
  id: string; name: string; company_name: string | null;
  account_id: string; system_id: string; email: string | null;
  portal_email: string | null; rate_email: string | null; status: string;
}

interface Country { name: string; iso_code: string; calling_code: string; }

interface Dest {
  country: string; country_code: string;
  network_name: string; mcc: string; mncMode: 'all' | 'specific'; mnc: string;
  currency: 'EUR' | 'USD'; rate: string;
}

interface SavedRate {
  id: string; country: string; country_code: string | null; network_name: string;
  mcc: string; mnc: string; currency: string; rate: string; updated_at: string;
}

interface Preview {
  to: string; from: string; from_name: string; subject: string;
  valid_from_display: string; html: string;
}

interface RnRow {
  id: string; client_name: string; account_id: string; system_id: string;
  recipient_email: string; subject: string; valid_from: string; status: string;
  created_by_email: string | null; created_at: string; sent_at: string | null;
  dest_count: string;
}

const emptyDest = (): Dest => ({
  country: '', country_code: '', network_name: '',
  mcc: '', mncMode: 'all', mnc: 'ALL', currency: 'EUR', rate: '',
});

function toLocalInput(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RateNotificationHistory(): JSX.Element {
  const [rows, setRows] = useState<RnRow[]>([]);
  useEffect(() => {
    api<{ notifications: RnRow[] }>('/rate-notifications').then((r) => setRows(r.notifications)).catch(() => undefined);
  }, []);
  return (
    <div>
      <PageHeader title="Rate Notifications" sub="Client rate emails sent from rates@8xtel.com" actions={<Link className="btn" to="/rate-notifications/new">+ Create Rate Notification</Link>} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr>
            <th>Date</th><th>Client</th><th>Account ID</th><th>System ID</th>
            <th>Recipient</th><th>Destinations</th><th>Status</th><th>Sent By</th><th>Sent At</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td><Link className="link" to={`/rate-notifications/${r.id}`}>{r.client_name}</Link></td>
                <td className="mono text-xs">{r.account_id}</td>
                <td className="mono text-xs">{r.system_id}</td>
                <td className="text-xs">{r.recipient_email}</td>
                <td className="text-center">{r.dest_count}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-xs">{r.created_by_email ?? '—'}</td>
                <td className="text-xs whitespace-nowrap">{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="text-center text-muted py-6">No rate notifications yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RateNotificationDetail(): JSX.Element {
  const { id } = useParams();
  const [data, setData] = useState<{ notification: Record<string, string | null>; rates: Array<Record<string, string>>; html: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = (): void => {
    api<{ notification: Record<string, string | null>; rates: Array<Record<string, string>>; html: string }>(`/rate-notifications/${id}`)
      .then(setData).catch((e) => setMsg(`Load failed: ${(e as Error).message}`));
  };
  useEffect(load, [id]);
  async function retry(): Promise<void> {
    setBusy(true); setMsg('');
    try {
      await api(`/rate-notifications/${id}/retry`, { method: 'POST' });
      setMsg('Resent ✓'); load();
    } catch (e) { setMsg(`Retry failed: ${(e as Error).message}`); }
    setBusy(false);
  }
  if (!data) return <div><PageHeader title="Rate Notification" sub="" /><p className="text-muted">{msg || 'Loading…'}</p></div>;
  const n = data.notification;
  return (
    <div>
      <PageHeader title={`Rate Notification — ${String(n.client_name ?? '')}`} sub={String(n.subject ?? '')} actions={<><Link className="btn-ghost" to="/rate-notifications">← History</Link>{n.status === 'failed' && <button className="btn" onClick={() => void retry()} disabled={busy}>{busy ? 'Retrying…' : 'Retry Send'}</button>}</>} />
      {msg && <div className="card card-pad mb-3 text-sm">{msg}</div>}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {[
          ['Client', n.client_name], ['Account ID', n.account_id], ['System ID', n.system_id],
          ['Recipient', n.recipient_email], ['Sender', n.sender_email], ['Subject', n.subject],
          ['Valid From', n.valid_from ? new Date(String(n.valid_from)).toLocaleString() : '—'],
          ['Status', n.status], ['Sent At', n.sent_at ? new Date(String(n.sent_at)).toLocaleString() : '—'],
          ['Sent By', n.created_by_email ?? '—'],
        ].map(([k, v]) => (
          <div key={k} className="card card-pad"><div className="label">{k}</div><div className="text-sm break-all">{v}</div></div>
        ))}
      </div>
      {n.error_message && <div className="card card-pad mb-3 text-sm text-red-300">Error: {n.error_message}</div>}
      <div className="card card-pad mb-3">
        <div className="card-title mb-2">Destinations ({data.rates.length})</div>
        <table className="table"><thead><tr><th>Country</th><th>Network</th><th>MCC</th><th>MNC</th><th className="text-right">Rate</th></tr></thead>
          <tbody>{data.rates.map((r, i) => (
            <tr key={i}><td>{r.country}</td><td>{r.network_name}</td><td className="text-center">{r.mcc}</td><td className="text-center">{r.mnc}</td><td className="text-right mono">{Number(r.rate).toFixed(3)} {r.currency}</td></tr>
          ))}</tbody></table>
      </div>
      <div className="card card-pad">
        <div className="card-title mb-2">Email preview</div>
        <iframe title="email" className="w-full rounded-lg border border-line" style={{ height: 520 }} srcDoc={data.html} />
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
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedRate[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [manageRates, setManageRates] = useState(false);

  function toDest(r: SavedRate): Dest {
    const all = r.mnc.toUpperCase() === 'ALL';
    return {
      country: r.country, country_code: r.country_code ?? '',
      network_name: r.network_name, mcc: r.mcc,
      mncMode: all ? 'all' : 'specific', mnc: all ? 'ALL' : r.mnc,
      currency: (r.currency === 'USD' ? 'USD' : 'EUR'), rate: String(r.rate),
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
    setBusy(true); setMsg('');
    try {
      await api(`/rate-notifications/saved-rates/${client.id}`, {
        method: 'POST',
        body: JSON.stringify({
          country: d.country, country_code: d.country_code || null,
          network_name: d.network_name.trim(), mcc: d.mcc, mnc,
          currency: d.currency, rate: Number(d.rate),
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
    setDest(i, {
      country: name, country_code: c?.iso_code ?? '',
      network_name: `${name} - Default`, mcc: c?.calling_code ?? '',
    });
  }

  function payload(): { client_id: string; valid_from: string; timezone: string; rates: unknown[] } | null {
    if (!client) { setMsg('Select a client first.'); return null; }
    if (!client.email) { setMsg('Selected client has no email on file.'); return null; }
    const rates: unknown[] = [];
    for (let i = 0; i < dests.length; i++) {
      const d = dests[i];
      if (!d.country) { setMsg(`Destination ${i + 1}: select a country.`); return null; }
      if (!d.network_name.trim()) { setMsg(`Destination ${i + 1}: enter a network name.`); return null; }
      if (!/^\d{3}$/.test(d.mcc)) { setMsg(`Destination ${i + 1}: MCC must be 3 digits.`); return null; }
      const mnc = d.mncMode === 'all' ? 'ALL' : d.mnc.trim().toUpperCase();
      if (!/^(\d{1,3}|ALL)$/.test(mnc)) { setMsg(`Destination ${i + 1}: MNC must be digits or ALL.`); return null; }
      const rate = Number(d.rate);
      if (!Number.isFinite(rate) || rate <= 0) { setMsg(`Destination ${i + 1}: rate must be a positive number.`); return null; }
      rates.push({
        country: d.country, country_code: d.country_code || null,
        network_name: d.network_name.trim(), mcc: d.mcc, mnc,
        currency: d.currency, rate,
      });
    }
    const vf = new Date(validFrom);
    if (Number.isNaN(vf.getTime())) { setMsg('Valid From is invalid.'); return null; }
    return { client_id: client.id, valid_from: vf.toISOString(), timezone: 'GMT', rates };
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

  async function doSend(): Promise<void> {
    const p = payload();
    if (!p) return;
    setBusy(true); setMsg('');
    try {
      const r = await api<{ id: string }>('/rate-notifications', { method: 'POST', body: JSON.stringify(p) });
      nav(`/rate-notifications/${r.id}`);
    } catch (e) { setMsg(`Send failed: ${(e as Error).message}`); setConfirming(false); }
    setBusy(false);
  }

  const subject = client ? `8xtel Rate notification _${client.account_id}/${client.system_id}` : '—';
  return (
    <div>
      <PageHeader title="Create Rate Notification" sub="Email rates to a client from rates@8xtel.com" actions={<Link className="btn-ghost" to="/rate-notifications">← History</Link>} />
      {msg && <div className="card card-pad mb-3 text-sm">{msg}</div>}

      <div className="card card-pad mb-3">
        <div className="card-title mb-2">1 · Client</div>
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
      </div>

      <div className="card card-pad mb-3">
        <div className="card-title mb-2">2 · Destinations</div>
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
      </div>

      {client && manageRates && (
        <div className="card card-pad mb-3">
          <div className="card-title mb-1">Add / update saved rates — {client.name}</div>
          <p className="text-[11px] text-muted mb-2">Saved rates prefill automatically next time you select this client. Sending a notification also auto-saves.</p>
          {dests.map((d, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 border-b border-line/40 text-xs">
              <span className="flex-1">{d.country || '—'} · {d.network_name || '—'} · {d.mcc || '—'}/{d.mncMode === 'all' ? 'ALL' : d.mnc || '—'} · {d.currency} {d.rate || '—'}</span>
              <button className="btn-ghost !py-0.5 !px-2 !text-[11px]" onClick={() => void saveRate(i)} disabled={busy || !d.country || !d.rate}>Save rate</button>
            </div>
          ))}
          {saved.length > 0 && (
            <div className="mt-2">
              <div className="label">Saved ({saved.length})</div>
              {saved.map((r) => (
                <div key={r.id} className="flex items-center gap-2 py-1 text-xs">
                  <span className="flex-1">{r.country} · {r.network_name} · {r.mcc}/{r.mnc} · {r.currency} {Number(r.rate).toFixed(3)}</span>
                  <button className="btn-ghost !py-0.5 !px-2 !text-[11px] text-red-300" onClick={() => void deleteSaved(r.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card card-pad mb-3">
        <div className="card-title mb-2">3 · Valid From (GMT)</div>
        <input type="datetime-local" className="input max-w-[260px]" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
      </div>

      <div className="flex gap-2 mb-3">
        <button className="btn-ghost" onClick={() => void doPreview()} disabled={busy}>{busy ? 'Working…' : 'Preview Email'}</button>
        <button className="btn" onClick={() => { if (payload()) setConfirming(true); }} disabled={busy || !preview}>Send Rate Notification</button>
      </div>

      {preview && (
        <div className="card card-pad mb-3">
          <div className="card-title mb-2">Email preview</div>
          <div className="text-xs mb-2 space-y-0.5">
            <div><span className="text-muted">To: </span><span className="mono">{preview.to}</span></div>
            <div><span className="text-muted">From: </span>{preview.from_name} &lt;<span className="mono">{preview.from}</span>&gt;</div>
            <div><span className="text-muted">Subject: </span><span className="mono">{preview.subject}</span></div>
          </div>
          <iframe title="preview" className="w-full rounded-lg border border-line" style={{ height: 520 }} srcDoc={preview.html} />
        </div>
      )}

      {confirming && preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirming(false)}>
          <div className="card card-pad max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="card-title mb-2">Are you sure you want to send this Rate Notification?</div>
            <div className="text-sm space-y-1 mb-4">
              <div><span className="text-muted">To: </span><span className="mono">{preview.to}</span></div>
              <div><span className="text-muted">Subject: </span><span className="mono">{preview.subject}</span></div>
              <div><span className="text-muted">Destinations: </span>{dests.length}</div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn" onClick={() => void doSend()} disabled={busy}>{busy ? 'Sending…' : 'Send Notification'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
