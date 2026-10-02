import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portalApi, API_BASE } from '../portal';
import { PageHeader, DataTable, StatusBadge, Money, Modal, StatCard, Donut } from '../components';

/* ── Types ── */
type ContentType = 'text' | 'rich_card' | 'carousel';
type SendTab = 'single' | 'bulk' | 'file';
interface Suggestion { type: 'reply' | 'open_url' | 'dial' | 'view_location'; text: string; url?: string; phone_number?: string; }
interface RichCard { title: string; description?: string; media_url?: string; suggestions: Suggestion[]; }

const emptySuggestion = (): Suggestion => ({ type: 'reply', text: '' });
const emptyCard = (): RichCard => ({ title: '', suggestions: [] });

export default function PortalRcsSend(): JSX.Element {
  const [tab, setTab] = useState<SendTab>('single');
  const [ctype, setCtype] = useState<ContentType>('text');
  // sender + destinations
  const [senders, setSenders] = useState<Array<{ sender: string; status: string }>>([]);
  const [useCustom, setUseCustom] = useState(false);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [bulk, setBulk] = useState('');
  const [fileNums, setFileNums] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [fileInfo, setFileInfo] = useState('');
  // content
  const [text, setText] = useState('');
  const [card, setCard] = useState<RichCard>(emptyCard());
  const [cards, setCards] = useState<RichCard[]>([emptyCard()]);
  // wallet / estimate
  const [rcsEnabled, setRcsEnabled] = useState<boolean | null>(null);
  const [wallet, setWallet] = useState<{ balance: string; reserved: string; currency: string } | null>(null);
  const [est, setEst] = useState<{ size_bytes: number; max_bytes: number; unit_price: number; estimated_cost: number } | null>(null);
  const [estBusy, setEstBusy] = useState(false);
  // send flow
  const [campaignName, setCampaignName] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [resultSingle, setResultSingle] = useState<{ id: string; price: string } | null>(null);
  const [resultCamp, setResultCamp] = useState<{ campaign_id: string; reserved_amount: string; summary: { total: number; valid: number } } | null>(null);

  useEffect(() => {
    portalApi<{ rcs_enabled: boolean; wallet: typeof wallet }>('/portal/rcs/me').then((r) => { setRcsEnabled(r.rcs_enabled); setWallet(r.wallet as never); }).catch(() => setRcsEnabled(false));
    portalApi<{ senders: typeof senders }>('/portal/rcs/senders').then((r) => {
      const ok = r.senders.filter((s) => s.status === 'approved');
      setSenders(ok);
      if (ok.length && !source) setSource(ok[0].sender);
      else if (!ok.length) setUseCustom(true);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildContent(): unknown {
    if (ctype === 'text') return { type: 'text', text };
    if (ctype === 'rich_card') return { type: 'rich_card', title: card.title, description: card.description || undefined, media_url: card.media_url || undefined, suggestions: card.suggestions.filter((s) => s.text.trim()) };
    return { type: 'carousel', cards: cards.filter((c) => c.title.trim()).map((c) => ({ title: c.title, description: c.description || undefined, media_url: c.media_url || undefined, suggestions: c.suggestions.filter((s) => s.text.trim()) })) };
  }

  // live estimate
  useEffect(() => {
    const c = buildContent();
    // crude check: need something to estimate
    const hasContent = ctype === 'text' ? text.trim().length > 0 : ctype === 'rich_card' ? card.title.trim().length > 0 : cards.some((x) => x.title.trim());
    if (!hasContent) { setEst(null); return; }
    const count = tab === 'single' ? 1 : tab === 'bulk' ? Math.max(1, bulk.split(/[,;\s\n\r\t|]+/).filter(Boolean).length) : Math.max(1, fileNums.length);
    const t = setTimeout(() => {
      setEstBusy(true);
      portalApi<typeof est>('/portal/rcs/estimate', { method: 'POST', body: JSON.stringify({ content: c, recipients: Math.min(count, 50000) }) })
        .then(setEst).catch(() => undefined).finally(() => setEstBusy(false));
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctype, text, card, cards, tab, bulk, fileNums]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name); setFileInfo(''); setFileNums([]);
    const fd = new FormData(); fd.append('file', f);
    try {
      const token = localStorage.getItem('xtel_portal_token');
      const res = await fetch(`${API_BASE}/portal/parse-file`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'parse failed');
      setFileNums(body.numbers ?? []);
      setFileInfo(`${(body.total as number).toLocaleString()} valid numbers` + (body.invalid?.length ? ` · ${body.invalid.length} invalid` : '') + (body.truncated ? ' · capped at 10,000' : ''));
    } catch (e) { setFileInfo((e as Error).message); }
  }

  const destCount = tab === 'single' ? (destination.trim() ? 1 : 0) : tab === 'bulk' ? bulk.split(/[,;\s\n\r\t|]+/).filter(Boolean).length : fileNums.length;
  const canSend = source && destCount > 0 && destCount <= 10000 && !sending && rcsEnabled;

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault(); setErr(''); setResultSingle(null); setResultCamp(null); setSending(true);
    const content = buildContent();
    try {
      if (destCount === 1 && tab === 'single') {
        const r = await portalApi<{ id: string; price: string }>('/portal/rcs/send', { method: 'POST', body: JSON.stringify({ from: source, to: destination.trim(), content }) });
        setResultSingle(r);
      } else {
        const payload: Record<string, unknown> = { from: source, content };
        if (campaignName.trim()) payload.name = campaignName.trim();
        if (tab === 'single') payload.recipients = [destination.trim()];
        else if (tab === 'bulk') payload.bulk = bulk;
        else payload.recipients = fileNums;
        const r = await portalApi<{ campaign_id: string; reserved_amount: string; summary: { total: number; valid: number } }>('/portal/rcs/campaigns', { method: 'POST', body: JSON.stringify(payload) });
        setResultCamp(r);
      }
    } catch (e) { setErr((e as Error).message); } finally { setSending(false); }
  }

  if (rcsEnabled === false) {
    return (
      <div className="space-y-5">
        <PageHeader title="Send RCS" sub="Rich Communication Services — text, rich cards & carousels" />
        <div className="card card-pad text-center py-10">
          <div className="text-lg font-bold">RCS is not enabled for your account</div>
          <div className="text-sm text-muted mt-2">Contact your account manager to enable RCS, add senders and credit your RCS wallet.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Send RCS" sub="Text, rich card or carousel · single, bulk or file · separate RCS wallet" />

      <div className="grid lg:grid-cols-5 gap-3">
        <div className="card card-pad lg:col-span-3">
          {/* tabs */}
          <div className="flex gap-1.5 mb-4">
            {([['single', 'Single'], ['bulk', 'Bulk'], ['file', 'File']] as Array<[SendTab, string]>).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setTab(v)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${tab === v ? 'border-brand/50 bg-brand/10 text-emerald-300' : 'border-line text-muted hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* content type */}
          <div className="flex gap-1.5 mb-4">
            {([['text', 'Text'], ['rich_card', 'Rich card'], ['carousel', 'Carousel']] as Array<[ContentType, string]>).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setCtype(v)}
                className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${ctype === v ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-line text-muted hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>

          <form onSubmit={send} className="space-y-4">
            {/* sender */}
            <div>
              <label className="label">Sender ID (RCS)</label>
              {senders.length && !useCustom ? (
                <div className="flex gap-2">
                  <select className="input font-mono flex-1" value={source} onChange={(e) => setSource(e.target.value)}>
                    {senders.map((s) => <option key={s.sender} value={s.sender}>{s.sender} (approved)</option>)}
                  </select>
                  <button type="button" className="btn-ghost shrink-0 !text-xs" onClick={() => { setUseCustom(true); setSource(''); }}>Other</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input className="input font-mono flex-1" value={source} onChange={(e) => setSource(e.target.value)} maxLength={40} placeholder="Your RCS sender (e.g. Brand)" />
                  {!!senders.length && <button type="button" className="btn-ghost shrink-0 !text-xs" onClick={() => { setUseCustom(false); setSource(senders[0].sender); }}>Approved</button>}
                </div>
              )}
              <p className="text-[11px] text-muted mt-1">Only approved RCS senders can be used. Ask admin to approve your sender.</p>
            </div>

            {/* campaign name */}
            <div>
              <label className="label">Campaign name <span className="text-gray-600">(optional · shown in RCS reports)</span></label>
              <input className="input" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} maxLength={160} placeholder="e.g. Diwali RCS — Mumbai" />
            </div>

            {/* destinations */}
            {tab === 'single' && (
              <div><label className="label">To (E.164 — e.g. +919876543210)</label><input className="input font-mono" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="+919876543210" /></div>
            )}
            {tab === 'bulk' && (
              <div><label className="label">Numbers (paste · commas / lines / spaces · up to 10,000)</label><textarea className="input font-mono min-h-[110px]" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'+919800000001\n+919800000002'} />{!!destCount && <div className="text-[11px] text-muted mt-1 tabular-nums">{destCount.toLocaleString()} numbers</div>}</div>
            )}
            {tab === 'file' && (
              <div>
                <label className="label">Numbers file (.txt / .csv)</label>
                <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-line hover:border-brand/50 transition cursor-pointer px-4 py-7 text-sm text-muted hover:text-white">
                  <input type="file" accept=".txt,.csv" className="hidden" onChange={onFile} />
                  {fileName ? <span className="font-mono text-gray-200">{fileName}</span> : <span>Click to upload · first column used · max 10,000</span>}
                </label>
                {fileInfo && <div className="text-[11px] text-muted mt-1">{fileInfo}</div>}
              </div>
            )}

            {/* content builder */}
            {ctype === 'text' && (
              <div><label className="label">Message text</label><textarea className="input min-h-[120px]" value={text} onChange={(e) => setText(e.target.value)} maxLength={4096} placeholder="Hello — your RCS message" /></div>
            )}
            {ctype === 'rich_card' && <RichCardEditor card={card} onChange={setCard} />}
            {ctype === 'carousel' && (
              <div className="space-y-3">
                {cards.map((c, i) => (
                  <div key={i} className="rounded-lg border border-line p-3 bg-ink/40">
                    <div className="flex items-center justify-between mb-2"><span className="text-xs font-bold">Card {i + 1}</span><button type="button" className="btn-ghost !py-0.5 !text-xs" onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))} disabled={cards.length === 1}>Remove</button></div>
                    <RichCardEditor card={c} onChange={(v) => setCards((cs) => cs.map((x, j) => j === i ? v : x))} />
                  </div>
                ))}
                {cards.length < 10 && <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={() => setCards((cs) => [...cs, emptyCard()])}>+ Add card ({cards.length}/10)</button>}
              </div>
            )}

            {err && <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{err}</div>}
            {(resultSingle || resultCamp) && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-center">
                <div className="text-emerald-300 font-bold">RCS {resultSingle ? 'message' : 'campaign'} queued! 🎉</div>
                {resultSingle && <div className="text-xs text-muted mt-1 font-mono">id {resultSingle.id} · price {resultSingle.price}</div>}
                {resultCamp && <div className="text-xs text-muted mt-1">{resultCamp.summary.valid} valid of {resultCamp.summary.total} · reserved {resultCamp.reserved_amount} · <Link className="text-sky-300 hover:underline" to={`/portal/rcs/reports/${resultCamp.campaign_id}`}>View report →</Link></div>}
                <div className="mt-3"><button type="button" className="btn-ghost !text-xs" onClick={() => { setResultSingle(null); setResultCamp(null); }}>Send more</button></div>
              </div>
            )}
            <button className="btn w-full" type="submit" disabled={!canSend}>
              {sending ? 'Queueing…' : destCount > 1 ? `Send RCS to ${destCount.toLocaleString()} numbers${est ? ` · ~${est.estimated_cost.toFixed(4)}` : ''}` : 'Send RCS'}
            </button>
            <div className="text-[11px] text-muted">SMPP RCS is text-only — rich cards & carousel are available via this portal and the HTTP API (<span className="font-mono">POST /rcs/v1/send</span> with <span className="font-mono">content.type</span>).</div>
          </form>
        </div>

        {/* estimate + wallet */}
        <div className="lg:col-span-2 space-y-3">
          <div className="card card-pad">
            <div className="card-title">Estimate</div>
            <div className="card-sub">Content size · recipients · cost</div>
            {!est ? (
              <div className="text-sm text-muted py-6 text-center">Enter content & recipients to see estimate.</div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs"><span className="text-muted">Size</span><span className="font-mono tabular-nums">{est.size_bytes.toLocaleString()} / {est.max_bytes.toLocaleString()} bytes</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted">Unit price</span><span className="font-mono tabular-nums">{est.unit_price.toFixed(6)}</span></div>
                <div className="rounded-lg bg-ink/60 border border-line px-3 py-2.5 text-sm">
                  <div className="text-xs text-muted">Est. cost</div><div className="text-lg font-bold tabular-nums">{estBusy ? '…' : `≈ ${est.estimated_cost.toFixed(4)}`}</div>
                </div>
                {est.size_bytes > est.max_bytes && <div className="text-xs text-red-300">Content exceeds max bytes — reduce text or media.</div>}
              </div>
            )}
          </div>
          <div className="card card-pad">
            <div className="card-title">RCS wallet</div>
            {wallet ? (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted">Balance</span><span className="font-mono tabular-nums font-bold">{Number(wallet.balance).toFixed(2)} {wallet.currency}</span></div>
                <Link to="/portal/rcs/history" className="btn-ghost !py-1 !text-xs mt-2 block text-center">View RCS history →</Link>
              </div>
            ) : <div className="text-sm text-muted">Loading wallet…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RichCardEditor({ card, onChange }: { card: RichCard; onChange: (v: RichCard) => void }): JSX.Element {
  return (
    <div className="space-y-2.5 rounded-lg border border-line p-3 bg-ink/30">
      <label className="space-y-1 block"><span className="label">Title *</span><input className="input" value={card.title} onChange={(e) => onChange({ ...card, title: e.target.value })} maxLength={200} placeholder="Card title" /></label>
      <label className="space-y-1 block"><span className="label">Description</span><textarea className="input min-h-[60px]" value={card.description ?? ''} onChange={(e) => onChange({ ...card, description: e.target.value })} maxLength={2000} /></label>
      <label className="space-y-1 block"><span className="label">Media URL (HTTPS)</span><input className="input font-mono" value={card.media_url ?? ''} onChange={(e) => onChange({ ...card, media_url: e.target.value })} placeholder="https://…" /></label>
      <div>
        <div className="flex items-center justify-between"><span className="label">Suggestions (buttons) — up to 10</span><button type="button" className="btn-ghost !py-0.5 !text-xs" onClick={() => onChange({ ...card, suggestions: [...card.suggestions, emptySuggestion()] })} disabled={card.suggestions.length >= 10}>+ Add</button></div>
        <div className="space-y-1.5 mt-1.5">
          {card.suggestions.map((s, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <select className="input !py-1 !text-xs max-w-[110px]" value={s.type} onChange={(e) => onChange({ ...card, suggestions: card.suggestions.map((x, j) => j === i ? { ...x, type: e.target.value as never } : x) })}>
                <option value="reply">reply</option><option value="open_url">open_url</option><option value="dial">dial</option><option value="view_location">view_location</option>
              </select>
              <input className="input !py-1 !text-xs flex-1" value={s.text} onChange={(e) => onChange({ ...card, suggestions: card.suggestions.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} placeholder="Button text" maxLength={80} />
              {s.type === 'open_url' && <input className="input !py-1 !text-xs flex-1 font-mono" value={s.url ?? ''} onChange={(e) => onChange({ ...card, suggestions: card.suggestions.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} placeholder="https://…" />}
              {s.type === 'dial' && <input className="input !py-1 !text-xs flex-1 font-mono" value={s.phone_number ?? ''} onChange={(e) => onChange({ ...card, suggestions: card.suggestions.map((x, j) => j === i ? { ...x, phone_number: e.target.value } : x) })} placeholder="+9198…" />}
              <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => onChange({ ...card, suggestions: card.suggestions.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          {!card.suggestions.length && <div className="text-xs text-muted">No buttons — add up to 10.</div>}
        </div>
      </div>
    </div>
  );
}
