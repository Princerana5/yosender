import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, Modal, Icon, Money, CurrencyBadge, StatusBadge } from '../components';

interface Wallet {
  client_id: string; client_name: string; system_id: string; client_status: string;
  balance: string; credit_limit: string; currency: string; billing_mode: string;
  sms_credits?: string | null;
}
interface CreditTx {
  id: number; type: string; amount: string; balance_after: string;
  description: string | null; remark: string | null; created_at: string;
  destination?: string | null;
}
interface Tx {
  id: number; client_name: string; type: string; amount: string; balance_after: string;
  description: string; remark: string | null; created_at: string; currency: string | null;
}
interface Fx {
  code: string; symbol: string; name: string; rate_to_usd: string;
  source?: string | null; refreshed_at?: string | null; updated_at?: string | null;
}

const CURS = ['USDT', 'EUR', 'INR'] as const;

type AdjKind = 'topup' | 'deduct';

export default function Billing(): JSX.Element {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [fx, setFx] = useState<Fx[]>([]);
  const [adj, setAdj] = useState<{ wallet: Wallet; kind: AdjKind } | null>(null);
  const [amount, setAmount] = useState('100');
  const [remark, setRemark] = useState('');
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState<Wallet | null>(null);
  const [newCur, setNewCur] = useState<string>('USDT');
  const [modeEdit, setModeEdit] = useState<Wallet | null>(null);
  const [modeDraft, setModeDraft] = useState<'prepay' | 'postpay' | 'credit'>('prepay');
  const [crediting, setCrediting] = useState<Wallet | null>(null);
  const [creditKind, setCreditKind] = useState<'grant' | 'deduct'>('grant');
  const [creditTxs, setCreditTxs] = useState<CreditTx[]>([]);
  const [creditDraft, setCreditDraft] = useState('0');
  const [editingFx, setEditingFx] = useState(false);
  const [fxDraft, setFxDraft] = useState<Record<string, string>>({});

  const load = (): void => {
    api<{ wallets: Wallet[] }>('/billing/wallets').then((r) => setWallets(r.wallets)).catch(() => undefined);
    api<{ transactions: Tx[] }>('/billing/transactions').then((r) => setTxs(r.transactions)).catch(() => undefined);
    api<{ currencies: Fx[] }>('/billing/currencies').then((r) => {
      setFx(r.currencies);
      setFxDraft(Object.fromEntries(r.currencies.map((c) => [c.code, c.rate_to_usd])));
    }).catch(() => undefined);
  };
  useEffect(load, []);

  function openAdj(wallet: Wallet, kind: AdjKind): void {
    setAdj({ wallet, kind });
    setAmount(kind === 'deduct' ? '10' : '100');
    setRemark('');
    setFormErr('');
  }

  async function doAdjust(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!adj) return;
    const n = Number(amount);
    if (!n || n <= 0) {
      setFormErr('Enter an amount greater than 0.');
      return;
    }
    if (remark.trim().length < 3) {
      setFormErr('Remark is required (min 3 characters) — it appears in the ledger.');
      return;
    }
    setBusy(true);
    setFormErr('');
    try {
      await api(`/billing/wallets/${adj.wallet.client_id}/${adj.kind}`, {
        method: 'POST',
        body: JSON.stringify({ amount: n, remark: remark.trim() }),
      });
      setAdj(null);
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doCurrencyChange(): Promise<void> {
    if (!changing) return;
    setBusy(true);
    try {
      const r = await api<{ converted: boolean; from: string; to: string }>(
        `/billing/wallets/${changing.client_id}/currency`,
        { method: 'POST', body: JSON.stringify({ currency: newCur }) },
      );
      if (!r.converted) alert(`Already in ${r.to} — nothing to convert.`);
      setChanging(null);
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openMode(w: Wallet): void {
    setModeEdit(w);
    setModeDraft(w.billing_mode === 'postpay' ? 'postpay' : w.billing_mode === 'credit' ? 'credit' : 'prepay');
    setCreditDraft(w.credit_limit);
    setFormErr('');
  }

  function openCredits(w: Wallet, kind: 'grant' | 'deduct'): void {
    setCrediting(w);
    setCreditKind(kind);
    setAmount(kind === 'deduct' ? '1000' : '10000');
    setRemark('');
    setFormErr('');
    setCreditTxs([]);
    api<{ transactions: CreditTx[] }>(`/billing/wallets/${w.client_id}/credits`)
      .then((r) => setCreditTxs(r.transactions))
      .catch(() => undefined);
  }

  async function doCreditAdj(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!crediting) return;
    const n = Number(amount);
    if (!n || n <= 0) {
      setFormErr('Enter a credit amount greater than 0.');
      return;
    }
    if (remark.trim().length < 3) {
      setFormErr('Remark is required (min 3 characters) — it appears in the ledger.');
      return;
    }
    setBusy(true);
    setFormErr('');
    try {
      await api(`/billing/wallets/${crediting.client_id}/credits/${creditKind}`, {
        method: 'POST',
        body: JSON.stringify({ amount: n, remark: remark.trim() }),
      });
      setCrediting(null);
      load();
    } catch (err) {
      setFormErr((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doModeChange(): Promise<void> {
    if (!modeEdit) return;
    const cl = Number(creditDraft);
    if (modeDraft === 'postpay' && (!cl || cl <= 0)) {
      setFormErr('Postpay requires a credit limit greater than 0.');
      return;
    }
    setBusy(true);
    setFormErr('');
    try {
      await api(`/billing/wallets/${modeEdit.client_id}/billing-mode`, {
        method: 'POST',
        body: JSON.stringify({ billing_mode: modeDraft, credit_limit: cl }),
      });
      setModeEdit(null);
      load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFx(): Promise<void> {
    setBusy(true);
    try {
      for (const [code, rate] of Object.entries(fxDraft)) {
        const orig = fx.find((f) => f.code === code)?.rate_to_usd;
        if (rate !== orig) {
          await api(`/billing/currencies/${code}`, { method: 'PATCH', body: JSON.stringify({ rate_to_usd: Number(rate) }) });
        }
      }
      setEditingFx(false);
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshFx(): Promise<void> {
    setBusy(true);
    try {
      await api('/billing/currencies/refresh', { method: 'POST' });
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const previewConvert = (w: Wallet): string => {
    const from = fx.find((f) => f.code === w.currency)?.rate_to_usd;
    const to = fx.find((f) => f.code === newCur)?.rate_to_usd;
    if (!from || !to || w.currency === newCur) return '';
    const sym = newCur === 'EUR' ? '€' : newCur === 'INR' ? '₹' : '₮';
    return `≈ ${sym}${(Number(w.balance) * Number(from) / Number(to)).toFixed(2)} ${newCur}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Wallets & ledger" sub="Prepay / postpay · top-up & deduct with remarks · USDT / EUR / INR" />

      <TopupQueue onDone={load} />

      <div className="card card-pad">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="card-title">Exchange rates → USDT</div>
            <div className="card-sub">
              1 unit = rate USDT (e.g. 1 INR ≈ {Number(fx.find((f) => f.code.trim() === 'INR')?.rate_to_usd ?? 0).toFixed(4)} USDT).
              Used only when a wallet changes currency. Auto-refreshes hourly from the live market.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fx.some((f) => (f.source ?? '') === 'live') && (
              <span className="badge bg-brand/10 text-emerald-300 border border-brand/25" title={
                `Last refresh: ${fx.filter((f) => f.refreshed_at).map((f) => `${f.code.trim()} ${new Date(f.refreshed_at!).toLocaleString()}`).join(' · ') || '—'}`
              }>
                <span className="relative flex w-1.5 h-1.5 mr-1">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 bg-emerald-400" />
                  <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-emerald-400" />
                </span>
                live
              </span>
            )}
            <button className="btn-ghost !py-1.5 !text-xs" onClick={refreshFx} disabled={busy || editingFx} title="Pull live market rates now">
              {busy ? 'Refreshing…' : '↻ Refresh live'}
            </button>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => editingFx ? saveFx() : setEditingFx(true)} disabled={busy}>
              {editingFx ? (busy ? 'Saving…' : 'Save rates') : 'Edit rates'}
            </button>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-2.5 mt-3">
          {fx.map((f) => (
            <div key={f.code} className="rounded-lg bg-ink/60 border border-line px-3 py-2.5 flex items-center gap-2.5">
              <CurrencyBadge code={f.code.trim()} />
              <div className="text-xs text-muted">
                <div>{f.symbol} {f.name}</div>
                <div className="text-[10px] opacity-70">
                  1 {f.code.trim()} = {Number(f.rate_to_usd).toFixed(f.code.trim() === 'INR' ? 4 : 4)} USDT
                  {(f.source ?? '') === 'live' && f.refreshed_at
                    ? ` · live ${new Date(f.refreshed_at).toLocaleString()}`
                    : (f.source ?? '') === 'manual' ? ' · manual' : ''}
                </div>
              </div>
              {editingFx ? (
                <input className="input font-mono !py-1 !text-xs ml-auto !w-28" value={fxDraft[f.code] ?? ''}
                  onChange={(e) => setFxDraft({ ...fxDraft, [f.code]: e.target.value })} />
              ) : (
                <div className="font-mono text-sm ml-auto">{Number(f.rate_to_usd).toFixed(4)}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {wallets.map((w) => {
          const bal = Number(w.balance);
          const postpay = w.billing_mode === 'postpay';
          const creditMode = w.billing_mode === 'credit';
          const credits = Number(w.sms_credits ?? 0);
          const low = !postpay && !creditMode && bal < 10;
          const overLimit = postpay && bal < -Number(w.credit_limit);
          const lowCredits = creditMode && credits < 100;
          return (
            <div key={w.client_id} className="card card-pad">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold truncate">{w.client_name}</div>
                <div className="flex items-center gap-1.5">
                  {(low || overLimit || lowCredits) && <span className="badge bg-warn/15 text-amber-300 border border-warn/25">low</span>}
                  {creditMode
                    ? <span className="badge border bg-violet-500/10 text-violet-300 border-violet-500/25">SMS</span>
                    : <CurrencyBadge code={w.currency} />}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className={`badge border ${postpay ? 'bg-sky-500/10 text-sky-300 border-sky-500/25' : creditMode ? 'bg-violet-500/10 text-violet-300 border-violet-500/25' : 'bg-brand/10 text-emerald-300 border-brand/25'}`}>
                  {postpay ? 'POSTPAY' : creditMode ? 'CREDITS' : 'PREPAY'}
                </span>
                <StatusBadge status={w.client_status} />
              </div>
              {creditMode ? (
                <>
                  <div className={`stat-value tabular-nums ${lowCredits ? 'text-amber-300' : 'text-violet-300'}`}>
                    {credits.toLocaleString()} <span className="text-sm font-normal text-muted">credits</span>
                  </div>
                  <div className="text-xs text-muted mt-1">1 credit = 1 SMS segment · failed sends refund automatically</div>
                </>
              ) : (
                <>
                  <div className={`stat-value ${low || overLimit ? 'text-amber-300' : postpay && bal < 0 ? 'text-sky-300' : 'text-emerald-300'}`}>
                    <Money value={w.balance} currency={w.currency} />
                  </div>
                  <div className="text-xs text-muted mt-1">
                    Credit limit <Money value={w.credit_limit} currency={w.currency} />
                    {postpay && <span> · available <Money value={Number(w.credit_limit) + bal} currency={w.currency} /></span>}
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-2 mt-3">
                {creditMode ? (
                  <>
                    <button className="btn !text-xs" onClick={() => openCredits(w, 'grant')}>
                      <Icon name="plus" size={13} /> Grant credits
                    </button>
                    <button className="btn-ghost !text-xs !border-danger/30 hover:!border-danger/60 hover:!text-red-300" onClick={() => openCredits(w, 'deduct')}>
                      − Deduct
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn !text-xs" onClick={() => openAdj(w, 'topup')}>
                      <Icon name="plus" size={13} /> Top up
                    </button>
                    <button className="btn-ghost !text-xs !border-danger/30 hover:!border-danger/60 hover:!text-red-300" onClick={() => openAdj(w, 'deduct')}>
                      − Deduct
                    </button>
                  </>
                )}
                <button className="btn-ghost !text-xs" title="Prepay / postpay / SMS credits + credit limit" onClick={() => openMode(w)}>
                  {postpay ? 'Postpay ⚙' : creditMode ? 'Credits ⚙' : 'Prepay ⚙'}
                </button>
                {!creditMode && (
                  <button className="btn-ghost !text-xs" title="Change currency"
                    onClick={() => { setChanging(w); setNewCur(w.currency); }}>
                    {w.currency} ⇄
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!wallets.length && (
          <div className="card card-pad text-sm text-muted md:col-span-3 text-center py-8">
            No wallets yet — they are created automatically with each client.
          </div>
        )}
      </div>

      <div>
        <div className="card-title mb-2 px-1">
          Ledger <span className="text-muted font-normal">· top-ups, deducts & adjustments only — per-SMS charges live in message reports</span>
        </div>
        <DataTable
          keyOf={(t) => String(t.id)}
          rows={txs}
          empty="No transactions yet."
          columns={[
            {
              key: 'created_at', label: 'Time',
              render: (t) => <span className="text-xs text-muted whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</span>,
            },
            { key: 'client_name', label: 'Client' },
            {
              key: 'type', label: 'Type',
              render: (t) => (
                <span className={`badge ${t.type === 'debit' ? 'bg-red-500/10 text-red-300 border border-red-500/25'
                  : t.type === 'refund' ? 'bg-warn/10 text-amber-300 border border-warn/25'
                    : t.type === 'adjustment' ? 'bg-sky-500/10 text-sky-300 border border-sky-500/25'
                      : 'bg-brand/10 text-emerald-300 border border-brand/25'}`}>
                  {t.type}
                </span>
              ),
            },
            {
              key: 'amount', label: 'Amount', right: true,
              render: (t) => <Money value={t.amount} currency={t.currency ?? undefined} tone />,
            },
            {
              key: 'balance_after', label: 'Balance after', right: true,
              render: (t) => <Money value={t.balance_after} currency={t.currency ?? undefined} />,
            },
            {
              key: 'remark', label: 'Remark',
              render: (t) => <span className="text-xs max-w-[260px] block truncate" title={t.remark ?? t.description}>{t.remark ?? t.description}</span>,
            },
          ]}
        />
      </div>

      {adj && (
        <Modal title={`${adj.kind === 'topup' ? 'Top up' : 'Deduct'} — ${adj.wallet.client_name}`} onClose={() => setAdj(null)}>
          <form onSubmit={doAdjust} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div className="flex items-center gap-2">
              <CurrencyBadge code={adj.wallet.currency} />
              <span className={`badge border ${adj.wallet.billing_mode === 'postpay' ? 'bg-sky-500/10 text-sky-300 border-sky-500/25' : 'bg-brand/10 text-emerald-300 border-brand/25'}`}>
                {adj.wallet.billing_mode === 'postpay' ? 'POSTPAY' : 'PREPAY'}
              </span>
              <span className="text-xs text-muted ml-auto">Balance <Money value={adj.wallet.balance} currency={adj.wallet.currency} /></span>
            </div>
            <div>
              <label className="label">Amount ({adj.wallet.currency})</label>
              <input className="input font-mono text-lg" value={amount}
                onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
            </div>
            <div>
              <label className="label">Remark <span className="text-red-400">*</span> <span className="text-gray-600">(required — shown in ledger)</span></label>
              <input className="input" placeholder={adj.kind === 'topup' ? 'e.g. Bank transfer ref HDFC-88231' : 'e.g. Penalty — spam complaint Sep'}
                value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
            <div className="rounded-lg bg-ink/60 border border-line px-3 py-2.5 text-sm font-mono">
              <Money value={adj.wallet.balance} currency={adj.wallet.currency} />
              <span className="text-muted"> → </span>
              <span className={adj.kind === 'topup' ? 'text-emerald-300' : 'text-red-300'}>
                <Money value={Number(adj.wallet.balance) + (adj.kind === 'topup' ? 1 : -1) * (Number(amount) || 0)} currency={adj.wallet.currency} />
              </span>
            </div>
            <div className="flex gap-2">
              <button className={`btn flex-1 ${adj.kind === 'deduct' ? '!bg-danger hover:!bg-red-500' : ''}`} type="submit" disabled={busy}>
                {busy ? 'Processing…' : adj.kind === 'topup' ? 'Confirm top-up' : 'Confirm deduct'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setAdj(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {modeEdit && (
        <Modal title={`Billing mode — ${modeEdit.client_name}`} onClose={() => setModeEdit(null)}>
          <div className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div className="grid grid-cols-3 gap-2">
              {(['prepay', 'postpay', 'credit'] as const).map((m) => (
                <button key={m} onClick={() => setModeDraft(m)}
                  className={`rounded-lg border px-3 py-3 text-left transition ${modeDraft === m
                    ? 'border-brand/50 bg-brand/10'
                    : 'border-line hover:border-brand/30'}`}>
                  <div className={`text-sm font-bold ${m === 'postpay' ? 'text-sky-300' : m === 'credit' ? 'text-violet-300' : 'text-emerald-300'}`}>
                    {m === 'prepay' ? 'PREPAY' : m === 'postpay' ? 'POSTPAY' : 'CREDITS'}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {m === 'prepay' ? 'Pay first — balance never below 0'
                      : m === 'postpay' ? 'Use now, pay later — up to credit limit'
                        : '1 credit = 1 segment — grant bundles, burns on send'}
                  </div>
                </button>
              ))}
            </div>
            <div>
              <label className="label">Credit limit ({modeEdit.currency}) {modeDraft === 'prepay' && <span className="text-gray-600">(unused in prepay)</span>}</label>
              <input className="input font-mono" value={creditDraft}
                onChange={(e) => setCreditDraft(e.target.value)} inputMode="decimal" />
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={doModeChange} disabled={busy}>
                {busy ? 'Saving…' : `Save as ${modeDraft}`}
              </button>
              <button className="btn-ghost" onClick={() => setModeEdit(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {crediting && (
        <Modal title={`${creditKind === 'grant' ? 'Grant SMS credits' : 'Deduct SMS credits'} — ${crediting.client_name}`} onClose={() => setCrediting(null)}>
          <form onSubmit={doCreditAdj} className="space-y-4">
            {formErr && <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{formErr}</div>}
            <div className="flex items-center gap-2">
              <span className="badge border bg-violet-500/10 text-violet-300 border-violet-500/25">SMS</span>
              <span className="badge border bg-violet-500/10 text-violet-300 border-violet-500/25">CREDITS</span>
              <span className="text-xs text-muted ml-auto">Balance <span className="font-mono font-semibold text-violet-300">{Number(crediting.sms_credits ?? 0).toLocaleString()}</span> credits</span>
            </div>
            <div>
              <label className="label">Credits (1 credit = 1 SMS segment)</label>
              <input className="input font-mono text-lg" value={amount}
                onChange={(e) => setAmount(e.target.value)} inputMode="numeric" autoFocus />
            </div>
            <div>
              <label className="label">Remark <span className="text-red-400">*</span> <span className="text-gray-600">(required — shown in ledger)</span></label>
              <input className="input" placeholder={creditKind === 'grant' ? 'e.g. Bundle purchase — 10k credits' : 'e.g. Correction — duplicate grant'}
                value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
            <div className="rounded-lg bg-ink/60 border border-line px-3 py-2.5 text-sm font-mono">
              <span className="text-violet-300">{Number(crediting.sms_credits ?? 0).toLocaleString()}</span>
              <span className="text-muted"> → </span>
              <span className={creditKind === 'grant' ? 'text-emerald-300' : 'text-red-300'}>
                {(Number(crediting.sms_credits ?? 0) + (creditKind === 'grant' ? 1 : -1) * (Number(amount) || 0)).toLocaleString()}
              </span>
              <span className="text-muted"> credits</span>
            </div>
            <div className="flex gap-2">
              <button className={`btn flex-1 ${creditKind === 'deduct' ? '!bg-danger hover:!bg-red-500' : ''}`} type="submit" disabled={busy}>
                {busy ? 'Processing…' : creditKind === 'grant' ? 'Confirm grant' : 'Confirm deduct'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setCrediting(null)}>Cancel</button>
            </div>
          </form>
          {creditTxs.length > 0 && (
            <div className="mt-5">
              <div className="card-title mb-2">Credit ledger <span className="text-muted font-normal">· latest {creditTxs.length}</span></div>
              <DataTable
                keyOf={(t) => String(t.id)}
                rows={creditTxs}
                empty="No credit movements yet."
                columns={[
                  {
                    key: 'created_at', label: 'Time',
                    render: (t) => <span className="text-xs text-muted whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</span>,
                  },
                  {
                    key: 'type', label: 'Type',
                    render: (t) => (
                      <span className={`badge ${t.type === 'burn' ? 'bg-red-500/10 text-red-300 border border-red-500/25'
                        : t.type === 'refund' ? 'bg-warn/10 text-amber-300 border border-warn/25'
                          : t.type === 'grant' ? 'bg-brand/10 text-emerald-300 border border-brand/25'
                            : 'bg-sky-500/10 text-sky-300 border border-sky-500/25'}`}>
                        {t.type}
                      </span>
                    ),
                  },
                  {
                    key: 'amount', label: 'Amount', right: true,
                    render: (t) => <span className={`tabular-nums ${Number(t.amount) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{Number(t.amount).toLocaleString()}</span>,
                  },
                  {
                    key: 'balance_after', label: 'Balance', right: true,
                    render: (t) => <span className="tabular-nums">{Number(t.balance_after).toLocaleString()}</span>,
                  },
                  {
                    key: 'remark', label: 'Remark',
                    render: (t) => <span className="text-xs max-w-[220px] block truncate" title={t.remark ?? t.description ?? ''}>{t.remark ?? t.description ?? (t.destination ? `SMS → ${t.destination}` : '—')}</span>,
                  },
                ]}
              />
            </div>
          )}
        </Modal>
      )}

      {changing && (
        <Modal title={`Change currency — ${changing.client_name}`} onClose={() => setChanging(null)}>
          <div className="space-y-4">
            <p className="text-xs text-muted">
              Balance and credit limit convert at the current FX rate. A ledger entry records the change.
            </p>
            <div className="flex gap-1.5">
              {CURS.map((c) => (
                <button key={c} onClick={() => setNewCur(c)}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${newCur === c
                    ? 'border-brand/50 bg-brand/10 text-emerald-300'
                    : 'border-line text-muted hover:text-white'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="rounded-lg bg-ink/60 border border-line px-3 py-2.5 text-sm font-mono">
              <Money value={changing.balance} currency={changing.currency} />
              <span className="text-muted"> → </span>
              <span className="text-emerald-300">{previewConvert(changing) || newCur}</span>
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={doCurrencyChange} disabled={busy || newCur === changing.currency}>
                {busy ? 'Converting…' : `Convert to ${newCur}`}
              </button>
              <button className="btn-ghost" onClick={() => setChanging(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Client top-up request queue (approve = real topup) ───────────────────────
interface TopupReq {
  id: string; client_id: string; client_name: string; amount: string;
  note: string | null; status: string; created_at: string;
}

function TopupQueue({ onDone }: { onDone: () => void }): JSX.Element {
  const [reqs, setReqs] = useState<TopupReq[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [review, setReview] = useState<TopupReq | null>(null);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    api<{ requests: TopupReq[] }>(`/billing/topup-requests${showAll ? '' : '?status=pending'}`)
      .then((r) => setReqs(r.requests))
      .catch(() => undefined);
  };
  useEffect(load, [showAll]);

  async function decide(action: 'approve' | 'reject'): Promise<void> {
    if (!review || remark.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/billing/topup-requests/${review.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, remark: remark.trim() }),
      });
      setReview(null);
      setRemark('');
      load();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const pending = reqs.filter((r) => r.status === 'pending');
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="card-title">
            Top-up requests
            {!!pending.length && (
              <span className="ml-2 badge bg-warn/15 text-amber-300 border border-warn/25">{pending.length} pending</span>
            )}
          </div>
          <div className="card-sub">Client asks → you approve (credits wallet) or reject</div>
        </div>
        <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Pending only' : 'Show all'}
        </button>
      </div>
      {!reqs.length ? (
        <div className="text-sm text-muted py-4 text-center">No {showAll ? '' : 'pending '}requests.</div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {reqs.slice(0, showAll ? 20 : 10).map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 text-sm bg-ink/50 border border-line/60 rounded-lg px-3 py-2">
              <span className="font-semibold">{r.client_name}</span>
              <span className="font-mono">+{Number(r.amount).toFixed(2)}</span>
              {r.note && <span className="text-xs text-muted truncate max-w-[220px]" title={r.note}>{r.note}</span>}
              <StatusBadge status={r.status === 'approved' ? 'delivered' : r.status === 'rejected' ? 'failed' : 'submitted'} />
              <span className="text-[11px] text-muted ml-auto">{new Date(r.created_at).toLocaleString()}</span>
              {r.status === 'pending' && (
                <button className="btn !py-1 !px-2.5 !text-xs shrink-0" onClick={() => { setReview(r); setRemark(''); }}>
                  Review
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {review && (
        <Modal title={`${review.client_name} · +${Number(review.amount).toFixed(2)}`} onClose={() => setReview(null)}>
          <div className="space-y-3">
            {review.note && <p className="text-xs text-muted">Client note: {review.note}</p>}
            <div>
              <label className="label">Remark * <span className="text-gray-600">(required — goes in the ledger)</span></label>
              <input className="input" placeholder="e.g. Bank transfer ref HDFC-88231"
                value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button className="btn flex-1" disabled={busy || remark.trim().length < 3} onClick={() => decide('approve')}>
                {busy ? '…' : 'Approve & credit'}
              </button>
              <button className="btn-ghost flex-1 !border-danger/30 hover:!border-danger/60 hover:!text-red-300"
                disabled={busy || remark.trim().length < 3} onClick={() => decide('reject')}>
                Reject
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
