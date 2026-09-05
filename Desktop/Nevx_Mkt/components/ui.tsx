"use client";

import { useEffect, useState } from "react";
import { cx, dealBadge, flagUrl, fmtMoney, initials, timeAgo } from "@/lib/utils";

/* ---------- Logo ---------- */
export function Logo({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="anim-glow grid h-9 w-9 place-items-center rounded-full bg-neon text-lg font-black text-[#04120b]">
        N
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-xl font-black tracking-tight text-white">
            NEV<span className="text-neon">X</span>
          </div>
          {!light && (
            <div className="text-[10px] font-medium tracking-wide text-[#7fbd97]">
              Where Needs Meet Offers
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({
  name,
  color,
  size = 40,
  flag,
}: {
  name: string;
  color: string;
  size?: number;
  flag?: string;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="grid h-full w-full place-items-center rounded-full font-bold text-white ring-1 ring-[#00e676]/30"
        style={{ background: color, fontSize: size * 0.36 }}
      >
        {initials(name)}
      </div>
      {flag ? (
        <img
          src={flagUrl(flag)}
          alt=""
          className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border border-[#04120b] object-cover"
        />
      ) : null}
    </div>
  );
}

/* ---------- Buttons (8xtel pill style) ---------- */
export function YellowButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cx(
        "rounded-full bg-neon px-5 py-2.5 text-sm font-black text-[#04120b] shadow-[0_0_22px_rgba(0,230,118,0.35)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cx(
        "rounded-full border border-[#1d5c3a] bg-[#0d2f22] px-5 py-2.5 text-sm font-bold text-[#eafff2] transition hover:border-[#00e676]/60 hover:bg-[#134e32] active:scale-[0.98] disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TealButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cx(
        "rounded-full bg-telegram px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

/* ---------- Circular icon action (like the reference's green circles) ---------- */
export function CircleAction({
  icon,
  label,
  onClick,
  href,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span className="anim-pulse-ring grid h-16 w-16 place-items-center rounded-full border border-[#00e676]/40 bg-[#00e676]/10 text-2xl text-neon transition group-hover:bg-[#00e676]/25">
        {icon}
      </span>
      <span className="mt-2 block text-center text-[11px] font-bold leading-tight text-[#b9e6c9]">
        {label}
      </span>
    </>
  );
  const cls = "group flex flex-col items-center transition hover:-translate-y-0.5";
  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/* ---------- Inputs ---------- */
export const inputCls =
  "w-full rounded-xl border border-[#134e32] bg-[#061b12] px-3.5 py-2.5 text-sm text-[#eafff2] outline-none transition placeholder:text-[#4d7a5f] focus:border-[#00e676] focus:ring-2 focus:ring-[#00e676]/25";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#7fbd97]">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[#4d7a5f]">{hint}</span> : null}
    </label>
  );
}

/* ---------- Modal ---------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "anim-pop max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-[#134e32] bg-[#0a251b] p-5 shadow-[0_0_60px_rgba(0,230,118,0.15)] sm:p-6",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-lg text-[#7fbd97] hover:bg-[#134e32]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Toast ---------- */
let toastPush: ((t: { msg: string; ok: boolean }) => void) | null = null;

export function toast(msg: string, ok = true) {
  toastPush?.({ msg, ok });
}

export function Toasts() {
  const [items, setItems] = useState<Array<{ id: number; msg: string; ok: boolean }>>([]);
  useEffect(() => {
    toastPush = ({ msg, ok }) => {
      const id = Date.now() + Math.random();
      setItems((p) => [...p, { id, msg, ok }]);
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 3200);
    };
    return () => {
      toastPush = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 sm:bottom-6">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "anim-pop pointer-events-auto w-full rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg",
            t.ok
              ? "border-[#00e676]/40 bg-[#0a251b] text-[#eafff2]"
              : "border-red-500/50 bg-[#2a0d0d] text-red-200"
          )}
        >
          {t.ok ? "✅ " : "⚠️ "}{t.msg}
        </div>
      ))}
    </div>
  );
}

/* ---------- Status badge ---------- */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold",
        dealBadge(status)
      )}
    >
      {status}
    </span>
  );
}

/* ---------- Empty state ---------- */
export function Empty({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-[#1d5c3a] bg-[#0a251b]/60 px-6 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-[#00e676]/10 text-3xl">
        {icon}
      </div>
      <div className="mt-3 font-extrabold text-white">{title}</div>
      {sub ? <div className="mt-1 max-w-xs text-sm text-[#7fbd97]">{sub}</div> : null}
    </div>
  );
}

/* ---------- Group flag chip ---------- */
const GROUP_EMOJI: Record<string, string> = {
  world: "🌍", in: "🇮🇳", us: "🇺🇸", cn: "🇨🇳", de: "🇩🇪", ae: "🇦🇪",
  gb: "🇬🇧", ca: "🇨🇦", au: "🇦🇺", sg: "🇸🇬", br: "🇧🇷", fr: "🇫🇷", jp: "🇯🇵",
};

export function groupEmoji(code: string): string {
  return GROUP_EMOJI[code] || "🌐";
}

/* ---------- Post meta line ---------- */
export function PostHead({
  name,
  color,
  country,
  createdAt,
  verified,
}: {
  name: string;
  color: string;
  country: string;
  createdAt: number;
  verified?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={name} color={color} size={38} />
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-1 truncate text-sm font-bold text-white">
          {name}
          {verified ? <span className="text-neon" title="Verified">✔</span> : null}
        </div>
        <div className="truncate text-xs text-[#7fbd97]">
          {country} · {timeAgo(createdAt)}
        </div>
      </div>
    </div>
  );
}

/* ---------- Report button ---------- */
export function ReportButton({
  targetType,
  targetId,
}: {
  targetType: "need" | "offer" | "user";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const reasons = ["Spam", "Fraud", "Illegal products", "Misleading offer", "Harassment", "Fake listing"];

  async function submit() {
    setBusy(true);
    const r = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId, reason, details }),
    });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      toast("Report sent. NEVX admin will review it.");
    } else {
      toast("Could not send report.", false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-[#4d7a5f] hover:text-red-400"
        title="Report"
      >
        🚩 Report
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Report this post">
        <div className="space-y-3">
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              {reasons.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Details (optional)">
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className={inputCls}
              rows={3}
              placeholder="What is wrong with this post?"
            />
          </Field>
          <YellowButton onClick={submit} disabled={busy} className="w-full">
            {busy ? "Sending…" : "Submit report"}
          </YellowButton>
        </div>
      </Modal>
    </>
  );
}

/* ---------- Section heading in neon green ---------- */
export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="text-center">
      <h2 className="text-2xl font-black tracking-tight text-[#00e676] sm:text-3xl">{children}</h2>
      {sub ? <p className="mx-auto mt-2 max-w-lg text-sm text-[#7fbd97]">{sub}</p> : null}
    </div>
  );
}

export function money(n?: number) {
  return fmtMoney(n || 0);
}
