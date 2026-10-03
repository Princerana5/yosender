import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader, StatusBadge } from '../components';

interface ClientOpt { id: string; name: string; system_id: string; status: string; is_house?: boolean; }
interface RouteOpt { id: string; name: string; strategy: string; status: string; }
interface CountryOpt { id: string; name: string; iso_code: string; calling_code: string; }
interface SendResult { id: string; client_msg_id: string; status: string; }

interface MsgDetail {
  message: { id: string; status: string; vendor_msg_id: string | null; error_code: string | null; error_description: string | null; client_price: string | null; vendor_cost: string | null; };
  events: Array<{ event: string; detail: string | null; created_at: string }>;
  dlr: { vendor_status: string; client_status: string } | null;
}

const POLL_MS = 2000;

// GSM-7 detection + normalizer (same as packages/core/src/sms.ts, inlined standalone)
const GSM_BASIC = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const GSM_EXT = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);
const NORMALIZE_MAP: Record<string, string> = {
  'ş':'s','Ş':'S','ğ':'g','Ğ':'G','ı':'i','İ':'I','ç':'c','Ç':'C','ö':'o','Ö':'O','ü':'u','Ü':'U',
  '‘':"'",'’':"'",'‚':",",'“':'"','”':'"','„':'"', '–':'-','—':'-','…':'...','•':'*','·':'.',
  ' ':' ',' ':' ',' ':' ', '™':'(TM)','®':'(R)','©':'(c)','°':'o','±':'+/-','×':'x','÷':'/','€':'EUR','£':'GBP',
};
function normalizeToGsm(text: string): { text: string; changed: string[] } {
  const changed = new Set<string>(); let out='';
  for (const ch of text) {
    if (GSM_BASIC.has(ch) || GSM_EXT.has(ch)) { out+=ch; continue; }
    const rep = NORMALIZE_MAP[ch];
    if (rep!==undefined) { out+=rep; changed.add(ch); } else out+=ch;
  }
  return { text: out, changed: [...changed] };
}
function analyzeText(text: string): { encoding: 'GSM-7'|'Unicode'; units: number; segments: number; singleLimit: number; perPart: number; nonGsmChars: string[] } {
  let hasUnicode = false; let units = 0;
  const nonGsm = new Set<string>();
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) units += 1;
    else if (GSM_EXT.has(ch)) units += 2;
    else { hasUnicode = true; nonGsm.add(ch); }
  }
  if (hasUnicode) {
    let u16 = 0; for (let i=0;i<text.length;i++){ const cp=text.codePointAt(i)!; u16+=cp>0xffff?2:1; if(cp>0xffff)i++; }
    return { encoding:'Unicode', units:u16, segments: u16<=70?1:Math.ceil(u16/67), singleLimit:70, perPart:67, nonGsmChars: [...nonGsm].slice(0, 8) };
  }
  return { encoding:'GSM-7', units, segments: units<=160?1:Math.ceil(units/153), singleLimit:160, perPart:153, nonGsmChars: [] };
}
function trimToUnits(text: string, maxUnits: number): string {
  let t = text;
  while (t.length > 0) {
    const a = analyzeText(t);
    if (a.units <= maxUnits) break;
    t = t.slice(0, -1);
  }
  return t;
}

export default function SendSms(): JSX.Element {
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [routes, setRoutes] = useState<RouteOpt[]>([]);
  const [countries, setCountries] = useState<CountryOpt[]>([]);
  const [clientId, setClientId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [source, setSource] = useState('8XTEL');
  const [destination, setDestination] = useState('');
  const [text, setText] = useState('Hello from 8xtelSMPP test');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<SendResult | null>(null);
  const [detail, setDetail] = useState<MsgDetail | null>(null);
  const [segCap, setSegCap] = useState<1|2>(1);

  useEffect(() => {
    api<{ clients: ClientOpt[] }>('/clients').then(r => {
      setClients(r.clients);
      const house = r.clients.find(c => c.is_house && c.status === 'active');
      const firstActive = r.clients.find(c => c.status === 'active');
      if (house) setClientId(house.id); else if (firstActive) setClientId(firstActive.id);
    }).catch(()=>undefined);
    api<{ routes: RouteOpt[] }>('/routes').then(r=>setRoutes(r.routes)).catch(()=>undefined);
    api<{ countries: CountryOpt[] }>('/system/countries').then(r=>setCountries(r.countries)).catch(()=>undefined);
  }, []);

  useEffect(() => {
    if (!sent) return;
    let dead=false;
    const terminal=new Set(['delivered','undelivered','expired','rejected','failed']);
    const poll=():void=>{ api<MsgDetail>(`/messages/${sent.id}`).then(r=>{ if(dead) return; setDetail(r); if(terminal.has(r.message.status)) clearInterval(t); }).catch(()=>undefined); };
    poll();
    const t=setInterval(poll, POLL_MS);
    return ()=>{ dead=true; clearInterval(t); };
  }, [sent]);

  const seg = analyzeText(text);
  const singleMax = seg.singleLimit;
  const twoMax = seg.perPart * 2;
  const maxForMode = segCap===1 ? singleMax : twoMax;
  const clampedUnits = Math.min(seg.units, maxForMode);
  const over = seg.units > maxForMode;
  const left = Math.max(0, maxForMode - seg.units);
  const leftInSeg = left;
  // preview what "Fit in 1 segment" would do (without applying)
  const normalizedPreview = (() => {
    if (seg.encoding !== 'Unicode') return null;
    const { text: norm, changed } = normalizeToGsm(text);
    if (!changed.length) return null;
    const a = analyzeText(norm);
    return { norm, changed, seg: a };
  })();

  function applySegCap(v: 1|2): void {
    setSegCap(v);
    const lim = v===1 ? analyzeText(text).singleLimit : analyzeText(text).perPart*2;
    if (analyzeText(text).units > lim) setText(trimToUnits(text, lim));
  }
  function onTextChange(v: string): void {
    const a = analyzeText(v);
    const lim = segCap===1 ? a.singleLimit : a.perPart*2;
    if (a.units > lim) setText(trimToUnits(v, lim));
    else setText(v);
  }
  function fitInOneSegment(): void {
    if (!normalizedPreview) return;
    // apply normalized text, then clamp to chosen cap
    let next = normalizedPreview.norm;
    const a = analyzeText(next);
    const lim = segCap===1 ? a.singleLimit : a.perPart*2;
    if (a.units > lim) next = trimToUnits(next, lim);
    setText(next);
  }

  async function send(): Promise<void> {
    setErr(''); setSent(null); setDetail(null);
    if (!clientId) { setErr('Pick a client first.'); return; }
    if (!destination.trim()) { setErr('Enter a destination number.'); return; }
    const a = analyzeText(text);
    if (!text.trim()) { setErr('Message cannot be empty.'); return; }
    if (a.units > (segCap===1 ? a.singleLimit : a.perPart*2)) {
      setErr(`Message exceeds ${segCap} segment limit (${segCap===1 ? singleMax : twoMax} units). Shorten it or switch to 2 segments.`);
      return;
    }
    setSending(true);
    try {
      const r = await api<SendResult>('/messages/send', {
        method:'POST',
        body: JSON.stringify({
          client_id: clientId,
          source,
          destination: destination.trim(),
          text,
          route_id: routeId||null,
        }),
      });
      setSent(r);
    } catch(e){ setErr((e as Error).message); } finally{ setSending(false); }
  }

  const canSend = !!clientId && !!destination.trim() && !!text.trim() && !over && !sending;

  return (
    <div className="space-y-5">
      <PageHeader title="Send test SMS" sub="Inject a message as a client · same pipeline as SMPP submit (route → vendor → DLR → billing)" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="card card-pad space-y-4">
          <div>
            <label className="label">Send as <span className="text-muted font-normal">(billed account)</span></label>
            <select className="input" value={clientId} onChange={e=>setClientId(e.target.value)}>
              <option value="">— select —</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.is_house?'🏠 ':''}{c.name} · {c.system_id}{c.status!=='active'?` (${c.status})`:''}</option>)}
            </select>
            <div className="text-[11px] text-muted mt-1">Test sends are billed to this account. 🏠 Main Account is the house account for console tests.</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">From (sender ID)</label>
              <input className="input font-mono" value={source} onChange={e=>setSource(e.target.value)} maxLength={21} placeholder="8XTEL" />
            </div>
            <div>
              <label className="label">To (destination)</label>
              <div className="flex gap-2">
                <input className="input font-mono flex-1" value={destination} onChange={e=>setDestination(e.target.value)} placeholder="919876543210" />
                <select className="input !w-auto max-w-[140px]" value="" onChange={e=>{ if(e.target.value) setDestination(e.target.value); }}>
                  <option value="">+code</option>
                  {countries.map(c=><option key={c.id} value={c.calling_code}>{c.iso_code} +{c.calling_code}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Route <span className="text-muted font-normal">(optional override)</span></label>
            <select className="input" value={routeId} onChange={e=>setRouteId(e.target.value)}>
              <option value="">Auto — normal route matching</option>
              {routes.map(r=><option key={r.id} value={r.id}>{r.name} · {r.strategy}{r.status!=='active'?` (${r.status})`:''}</option>)}
            </select>
            {routeId ? (
              <div className="text-xs text-amber-300 bg-warn/10 border border-warn/25 rounded-lg px-3 py-2 mt-2">
                Forced route — its vendor chain applies. Block/reject filters still apply.
              </div>
            ) : (
              <div className="text-[11px] text-muted mt-1">Leave on Auto to test real routing; pick a route to force that path.</div>
            )}
          </div>

          {/* Segments & cost — same look as portal (portal-pages.tsx) */}
          <div className="rounded-xl border border-line bg-ink/40 px-4 py-3.5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-widest uppercase text-muted">Segments & cost</span>
              <span className="text-[11px] text-muted">· Live preview · billing is per segment</span>
            </div>
            {!text ? (
              <div className="text-sm text-muted py-4 text-center">Type a message to see encoding, segments and cost.</div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className={`badge border text-[11px] font-bold tracking-wide px-2.5 py-1 ${seg.encoding==='Unicode' ? 'bg-warn/15 text-amber-300 border-warn/30' : 'bg-brand/15 text-emerald-300 border-brand/30'}`}>
                    {seg.encoding==='Unicode' ? 'UNICODE (UCS-2)' : 'GSM-7'}
                  </span>
                  <span className="ml-auto text-2xl font-extrabold tabular-nums">{seg.segments} seg</span>
                  <div className="inline-flex rounded-lg border border-line overflow-hidden shrink-0">
                    <button type="button"
                      className={`px-2.5 py-1 text-xs font-semibold transition ${segCap===1 ? 'bg-brand text-white' : 'bg-panel text-muted hover:text-gray-200'}`}
                      onClick={()=>applySegCap(1)}>1 seg</button>
                    <button type="button"
                      className={`px-2.5 py-1 text-xs font-semibold transition border-l border-line ${segCap===2 ? 'bg-brand text-white' : 'bg-panel text-muted hover:text-gray-200'}`}
                      onClick={()=>applySegCap(2)}>2 seg</button>
                  </div>
                </div>
                <div className="text-xs text-muted tabular-nums">
                  {seg.units} units · {leftInSeg} left in this cap · <b className="text-gray-200">{seg.segments} segment(s)</b> · {segCap} seg max ({segCap===1 ? `${singleMax}` : `${singleMax} + ${seg.perPart}`} = {maxForMode})
                  <span className={`ml-2 ${over ? 'text-red-300 font-semibold' : left <= 10 ? 'text-amber-300' : 'text-muted'}`}>{over ? '· over limit' : `· ${left} left`}</span>
                </div>
                {seg.encoding==='Unicode' && seg.nonGsmChars.length>0 && (
                  <div className="text-xs bg-warn/10 border border-warn/25 rounded-lg px-3 py-2 space-y-2">
                    <div className="text-amber-300">
                      ⚠ Unicode detected — triggered by: {seg.nonGsmChars.map(c=>`"${c}"`).join(' ')}.
                      {seg.segments>1 ? ` This message costs ${seg.segments}× per number.` : ' Still 1 segment, but any longer text splits at 67 chars.'}
                    </div>
                    {normalizedPreview && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-amber-200 text-[11px]">Can save: {normalizedPreview.changed.map(c=>`"${c}"→"${NORMALIZE_MAP[c] ?? ''}"`).join(' ')} → {normalizedPreview.seg.encoding==='Unicode' ? `still Unicode` : 'GSM-7'} {normalizedPreview.seg.units}u · {normalizedPreview.seg.segments} seg</span>
                        <button type="button" onClick={fitInOneSegment}
                          className="ml-auto text-xs font-bold px-3 py-1 rounded-full bg-amber-400 text-black hover:bg-amber-300 border border-amber-300 shadow">
                          Fit in 1 segment
                        </button>
                      </div>
                    )}
                    {!normalizedPreview && <div className="text-[11px] text-muted">These characters can't be mapped to GSM — stays Unicode.</div>}
                  </div>
                )}
                <div className="text-[11px] text-muted">
                  {segCap===1 ? `Single SMS — capped at ${singleMax} ${seg.encoding==='Unicode'?'chars (Unicode)':'septets (GSM-7)'}.` : `Concatenated — up to ${twoMax} units across 2 parts (${singleMax} + ${seg.perPart}).`}
                  {seg.encoding==='Unicode' && <span className="ml-1 text-amber-300">Contains non-GSM chars → Unicode (70 / 67 per part).</span>}
                </div>
                {over && <div className="text-xs text-red-300 font-medium">Message exceeds the {segCap}-segment cap and will be trimmed.</div>}
              </>
            )}
          </div>

          <div>
            <label className="label">Message</label>
            <textarea className="input min-h-[140px]" value={text} onChange={e=>onTextChange(e.target.value)} maxLength={segCap===1 ? singleMax*2 : twoMax*2} placeholder={segCap===1 ? 'Single-segment message…' : 'Up to 2 segments…'} />
            <div className="flex justify-between text-[11px] text-muted mt-1 tabular-nums">
              <span className={over ? 'text-red-300 font-semibold' : ''}>{clampedUnits}/{maxForMode} units · {seg.encoding} · {seg.segments} part{seg.segments>1?'s':''} {segCap===1 ? '(1 max)' : '(2 max)'}</span>
              <span>Billed + routed like real traffic</span>
            </div>
          </div>

          {err && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{err}</div>}

          <button
            className="w-full rounded-xl font-extrabold text-[15px] py-3.5 shadow-lg shadow-amber-400/25 ring-1 ring-amber-300/40 bg-amber-400 hover:bg-amber-300 text-black transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            onClick={send} disabled={!canSend}>
            {sending ? 'Sending…' : '✉ Send test SMS'}
          </button>
          {!canSend && !sending && <div className="text-[11px] text-muted text-center -mt-1">Pick a billed account, destination and message to enable.</div>}
        </div>

        <div className="card card-pad">
          <div className="card-title">Delivery tracking</div>
          <div className="card-sub">Live status · polls every 2s until terminal</div>
          {!sent && !err && <div className="text-sm text-muted py-10 text-center">Send a message to watch it flow through routing → vendor → DLR here.</div>}
          {sent && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={detail?.message.status ?? sent.status} />
                <span className="text-xs text-muted font-mono">{sent.id.slice(0,8)}</span>
                <Link to={`/messages?message_id=${sent.id}`} className="text-xs text-brand hover:underline ml-auto">Open in logs →</Link>
              </div>
              <div className="text-xs space-y-1.5 font-mono">
                <div className="flex justify-between"><span className="text-muted">vendor msg id</span><span>{detail?.message.vendor_msg_id ?? '…'}</span></div>
                <div className="flex justify-between"><span className="text-muted">price / cost</span><span>{detail?.message.client_price ?? '…'} / {detail?.message.vendor_cost ?? '…'}</span></div>
                {detail?.dlr && <div className="flex justify-between"><span className="text-muted">DLR</span><span>{detail.dlr.vendor_status} → {detail.dlr.client_status}</span></div>}
                {detail?.message.error_description && <div className="text-red-300 break-all">{detail.message.error_description}</div>}
              </div>
              {!!detail?.events.length && (
                <div>
                  <div className="stat-label mb-1.5">Pipeline trail</div>
                  <ol className="space-y-1.5">
                    {detail.events.map((e,i)=>(
                      <li key={i} className="flex gap-2 text-xs">
                        <span className="text-muted font-mono whitespace-nowrap">{new Date(e.created_at).toLocaleTimeString()}</span>
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

      <div className="text-[11px] text-muted">Tip: watch it appear on <Link to="/traffic" className="text-brand hover:underline">Live traffic</Link> with content visible via 👁 Show content.</div>
    </div>
  );
}
