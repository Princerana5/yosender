import React from 'react';
import { fmtMoney } from './api';

// ── Inline SVG icon set (no dependency) ──────────────────────────────────────
const P: Record<string, JSX.Element> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  pulse: <><path d="M3 12h4l2.5-6 4 12L16 12h5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.6c2.3.2 3.9 1.6 4.4 4" /></>,
  server: <><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><circle cx="7" cy="7.5" r="0.8" fill="currentColor" /><circle cx="7" cy="16.5" r="0.8" fill="currentColor" /></>,
  plug: <><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7Z" /><path d="M12 16v5" /></>,
  route: <><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" /><path d="M8.4 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h3.6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 15h2" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-8M21 20H3" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9.5 12 2 2 3.5-4" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c-4.5 4.5-4.5 12.5 0 17M12 3.5c4.5 4.5 4.5 12.5 0 17" /></>,
  tag: <><path d="M4 4h7l9 9-7 7-9-9V4Z" /><circle cx="9" cy="9" r="1.4" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  sliders: <><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="10" cy="7" r="2" fill="#0a0f14" /><circle cx="15" cy="12" r="2" fill="#0a0f14" /><circle cx="8" cy="17" r="2" fill="#0a0f14" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6M20 3v4h-4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></>,
  bolt: <><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></>,
};

export function Icon({ name, size = 16, className = '' }: { name: keyof typeof P; size?: number; className?: string }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {P[name]}
    </svg>
  );
}

// ── Status badge with pulse dot ──────────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  delivered: 'bg-brand/15 text-emerald-300 border border-brand/25',
  active: 'bg-brand/15 text-emerald-300 border border-brand/25',
  connected: 'bg-brand/15 text-emerald-300 border border-brand/25',
  enabled: 'bg-brand/15 text-emerald-300 border border-brand/25',
  approved: 'bg-brand/15 text-emerald-300 border border-brand/25',
  submitted: 'bg-sky-500/15 text-sky-300 border border-sky-500/25',
  connecting: 'bg-sky-500/15 text-sky-300 border border-sky-500/25',
  pending: 'bg-warn/15 text-amber-300 border border-warn/25',
  reconnecting: 'bg-warn/15 text-amber-300 border border-warn/25',
  undelivered: 'bg-warn/15 text-amber-300 border border-warn/25',
  expired: 'bg-orange-500/15 text-orange-300 border border-orange-500/25',
  rejected: 'bg-danger/15 text-red-300 border border-danger/25',
  failed: 'bg-danger/15 text-red-300 border border-danger/25',
  blocked: 'bg-danger/15 text-red-300 border border-danger/25',
  error: 'bg-danger/15 text-red-300 border border-danger/25',
  suspended: 'bg-orange-500/15 text-orange-300 border border-orange-500/25',
  disabled: 'bg-gray-500/15 text-gray-400 border border-gray-500/25',
  unknown: 'bg-gray-500/15 text-gray-400 border border-gray-500/25',
};

const DOT_STYLE: Record<string, string> = {
  delivered: 'bg-emerald-400', active: 'bg-emerald-400', connected: 'bg-emerald-400', enabled: 'bg-emerald-400', approved: 'bg-emerald-400',
  submitted: 'bg-sky-400', connecting: 'bg-sky-400', pending: 'bg-amber-400', reconnecting: 'bg-amber-400', undelivered: 'bg-amber-400',
  failed: 'bg-red-400', rejected: 'bg-red-400', blocked: 'bg-red-400', error: 'bg-red-400',
};

export function StatusBadge({ status }: { status: string }): JSX.Element {
  const s = (status ?? 'unknown').toLowerCase();
  const live = ['connected', 'active'].includes(s);
  return (
    <span className={`badge ${STATUS_STYLE[s] ?? STATUS_STYLE.unknown}`}>
      <span className="relative flex w-1.5 h-1.5">
        {live && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${DOT_STYLE[s] ?? 'bg-gray-400'}`} />}
        <span className={`relative inline-flex rounded-full w-1.5 h-1.5 ${DOT_STYLE[s] ?? 'bg-gray-400'}`} />
      </span>
      {status}
    </span>
  );
}

// ── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-[13px] text-muted mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Stat card with delta + sparkline ─────────────────────────────────────────
export function StatCard({ label, value, sub, spark, tone }: {
  label: string; value: string; sub?: string; spark?: number[]; tone?: 'brand' | 'danger' | 'warn' | 'accent';
}): JSX.Element {
  const tones: Record<string, string> = {
    brand: 'text-emerald-300', danger: 'text-red-300', warn: 'text-amber-300', accent: 'text-sky-300',
  };
  const max = Math.max(1, ...(spark ?? [1]));
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? tones[tone] : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
      {spark && spark.length > 1 && (
        <div className="flex items-end gap-[3px] h-9 mt-3">
          {spark.map((v, i) => (
            <div key={i} className="flex-1 rounded-sm bg-brand/70" style={{ height: `${Math.max(8, (v / max) * 100)}%`, opacity: 0.35 + (0.65 * i) / spark.length }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Donut (delivery mix) ─────────────────────────────────────────────────────
export function Donut({ slices, size = 150, center }: {
  slices: Array<{ value: number; color: string; label: string }>; size?: number; center?: string;
}): JSX.Element {
  const total = Math.max(1, slices.reduce((s, x) => s + x.value, 0));
  const R = 54;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 140 140" width={size} height={size} className="-rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#1f2c38" strokeWidth="16" />
          {slices.map((s, i) => {
            const frac = s.value / total;
            const el = (
              <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="16"
                strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C} strokeLinecap="butt" />
            );
            acc += frac;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold tabular-nums">{center}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-gray-300">{s.label}</span>
            <span className="text-muted tabular-nums ml-auto pl-3">{s.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bars (hourly traffic) ────────────────────────────────────────────────────
export function Bars({ data, height = 140 }: { data: Array<{ label: string; total: number; ok: number }>; height?: number }): JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end gap-[2px] group relative" style={{ height: '100%' }}>
            <div className="rounded-t bg-brand/80 hover:bg-brand transition" style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total ? 3 : 0 }} />
            <div className="hidden group-hover:block absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap bg-panel2 border border-line rounded px-2 py-1 text-[11px] z-10">
              {d.label} · {d.total.toLocaleString()}
            </div>
          </div>
        ))}
        {!data.length && <div className="text-sm text-muted py-8">No traffic in this window yet.</div>}
      </div>
      <div className="flex justify-between text-[10px] text-muted mt-1.5">
        <span>{data[0]?.label ?? ''}</span>
        <span>{data[data.length - 1]?.label ?? ''}</span>
      </div>
    </div>
  );
}

// ── Data table ───────────────────────────────────────────────────────────────
export function DataTable<T>({ columns, rows, keyOf, empty }: {
  columns: Array<{ key: string; label: string; render?: (row: T) => React.ReactNode; mono?: boolean; right?: boolean }>;
  rows: T[];
  keyOf: (row: T, i: number) => string;
  empty?: string;
}): JSX.Element {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr>{columns.map((c) => (
            <th key={c.key} className={c.right ? '!text-right' : ''}>{c.label}</th>
          ))}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={keyOf(r, i)}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.mono ? 'font-mono text-[12px]' : ''} ${c.right ? '!text-right tabular-nums' : ''}`}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-8 text-center text-sm text-muted">{empty ?? 'No records found.'}</div>}
      </div>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? '!max-w-2xl' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold">{title}</div>
          <button className="btn-ghost !px-2 !py-1" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Search input ─────────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, onSearch, placeholder }: {
  value: string; onChange: (v: string) => void; onSearch: () => void; placeholder?: string;
}): JSX.Element {
  return (
    <div className="relative max-w-sm">
      <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
      <input className="input !pl-9" placeholder={placeholder ?? 'Search…'} value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSearch()} />
    </div>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────
export function Money({ value, currency, tone, decimals }: {
  value: number | string | null | undefined;
  currency?: string;
  tone?: boolean;
  decimals?: number;
}): JSX.Element {
  const n = Number(value ?? 0);
  return <span className={`tabular-nums ${tone && n < 0 ? 'text-red-300' : ''}`}>{fmtMoney(n, currency, decimals)}</span>;
}

export function CurrencyBadge({ code }: { code: string }): JSX.Element {
  const style: Record<string, string> = {
    USD: 'bg-brand/10 text-emerald-300 border-brand/25',
    EUR: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    INR: 'bg-warn/10 text-amber-300 border-warn/25',
  };
  return <span className={`badge border ${style[code] ?? style.USD}`}>{code}</span>;
}

// ── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub, action }: {
  icon: 'users' | 'server' | 'mail' | 'wallet' | 'route'; title: string; sub?: string; action?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="card card-pad text-center py-12">
      <div className="mx-auto w-11 h-11 rounded-xl bg-panel2 border border-line flex items-center justify-center text-muted mb-3">
        <Icon name={icon} size={20} />
      </div>
      <div className="font-semibold">{title}</div>
      {sub && <div className="text-sm text-muted mt-1 max-w-sm mx-auto">{sub}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
