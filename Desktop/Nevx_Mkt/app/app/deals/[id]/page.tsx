"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, StatusBadge, toast } from "@/components/ui";
import { cx, fmtMoney, timeAgo } from "@/lib/utils";

export default function DealDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  async function load() {
    const r = await fetch(`/api/deals/${id}`);
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/deals/${id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setBusy(false);
    if (r.ok) {
      setText("");
      load();
    } else {
      const j = await r.json().catch(() => ({}));
      toast(j.error || "Could not send.", false);
    }
  }

  if (!data) return <div className="p-6 text-sm text-[#7fbd97]">Loading deal…</div>;
  const { deal, need, messages } = data;
  const closed = ["Completed", "Cancelled"].includes(deal.status);

  return (
    <div className="mx-auto max-w-5xl gap-4 p-3 sm:p-4 lg:flex">
      {/* info */}
      <div className="space-y-3 lg:w-80 lg:shrink-0">
        <Link href="/app/deals" className="text-sm font-bold text-neon">
          ← All deals
        </Link>
        <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-black text-white">DEAL #{deal.id}</div>
            <StatusBadge status={deal.status} />
          </div>
          <div className="mt-1 text-sm text-[#b9e6c9]">{deal.title}</div>
          <div className="mt-1 inline-flex rounded-full border border-[#134e32] bg-[#0d2f22] px-2.5 py-1 text-[11px] font-bold uppercase text-[#7fbd97]">
            You are the {deal.role}
          </div>
          {need && (
            <div className="mt-3 rounded-xl border border-[#134e32] bg-[#061b12] p-3 text-xs leading-relaxed text-[#b9e6c9]">
              <b className="text-white">Need:</b> {need.title}
              <br />
              <b className="text-white">Category:</b> {need.category}
            </div>
          )}
          <div className="mt-3 space-y-1.5 text-sm">
            <Row k="NEVX Admin" v="Handling your deal 🛡️" />
            <Row k="Agreed price" v={fmtMoney(deal.agreedPrice)} bold />
            <Row k="Admin fee" v={fmtMoney(deal.commission)} />
            <Row k="Total" v={fmtMoney(deal.finalAmount)} bold />
            <Row k="Payment" v={deal.paymentStatus} />
            <Row k="Delivery" v={deal.deliveryStatus} />
          </div>
          <div className="mt-3 rounded-xl border border-[#00e676]/25 bg-[#00e676]/10 p-3 text-[11px] leading-relaxed text-[#b9e6c9]">
            🔒 {deal.role === "buyer"
              ? `Seller: ${deal.seller?.name} (${deal.seller?.country})`
              : `Buyer: ${deal.buyer?.name} (${deal.buyer?.country})`}
            <br />
            Contact details are hidden — admin relays everything.
          </div>
        </div>
      </div>

      {/* chat */}
      <div className="mt-4 flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-2xl border border-[#134e32] bg-[#0a251b] lg:mt-0">
        <div className="flex items-center gap-3 border-b border-[#134e32] bg-[#061b12] px-4 py-3 text-white">
          <Avatar name="NEVX Admin" color="#00c464" size={36} />
          <div className="leading-tight">
            <div className="text-sm font-extrabold">NEVX Admin 🛡️</div>
            <div className="text-[11px] text-[#7fbd97]">Mediator · replies usually fast</div>
          </div>
          <span className="ml-auto"><StatusBadge status={deal.status} /></span>
        </div>
        <div className="slim-scroll flex-1 space-y-2.5 overflow-y-auto bg-[#04120b] p-4">
          {messages.length === 0 && (
            <div className="grid place-items-center py-10 text-center text-sm text-[#4d7a5f]">
              👋 Say hi to NEVX Admin to start.
            </div>
          )}
          {messages.map((m: any) => {
            const mine = m.sender === "user";
            return (
              <div key={m.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cx(
                    "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm",
                    mine
                      ? "rounded-br-md bg-neon font-medium text-[#04120b]"
                      : "rounded-bl-md border border-[#134e32] bg-[#0a251b] text-[#eafff2]",
                    "anim-fade-up"
                  )}
                >
                  {!mine && (
                    <div className="mb-0.5 text-[11px] font-bold text-neon">NEVX Admin 🛡️</div>
                  )}
                  <div className="leading-relaxed">{m.text}</div>
                  <div className={cx("mt-1 text-right text-[10px]", mine ? "text-[#04120b]/60" : "text-[#4d7a5f]")}>
                    {timeAgo(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
        <div className="border-t border-[#134e32] p-3">
          {closed ? (
            <div className="rounded-xl bg-[#0d2f22] p-3 text-center text-xs font-bold text-[#7fbd97]">
              This deal is {deal.status.toLowerCase()}. Chat is closed.
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Message NEVX Admin…"
                className="flex-1 rounded-full border border-[#134e32] bg-[#061b12] px-4 py-2.5 text-sm text-white outline-none placeholder:text-[#4d7a5f] focus:border-[#00e676]/60"
                maxLength={1000}
              />
              <button
                onClick={send}
                disabled={busy || !text.trim()}
                className="rounded-full bg-neon px-5 py-2.5 text-sm font-black text-[#04120b] transition hover:brightness-110 disabled:opacity-50"
              >
                ➤
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, bold = false }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-[#7fbd97]">{k}</span>
      <span className={cx("text-sm", bold ? "font-extrabold text-white" : "font-semibold text-[#b9e6c9]")}>
        {v}
      </span>
    </div>
  );
}
