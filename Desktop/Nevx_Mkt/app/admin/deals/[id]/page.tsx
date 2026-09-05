"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, Field, StatusBadge, YellowButton, inputCls, toast } from "@/components/ui";
import { cx, DEAL_STATUSES, fmtMoney, timeAgo } from "@/lib/utils";

export default function AdminDealDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<any>(null);
  const [side, setSide] = useState<"buyer" | "seller">("buyer");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editPrice, setEditPrice] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  async function load() {
    const r = await fetch(`/api/deals/${id}`);
    if (r.ok) {
      const j = await r.json();
      setData(j);
      if (!editPrice) setEditPrice(String(j.deal.agreedPrice));
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length, side]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/deals/${id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, side }),
    });
    setBusy(false);
    if (r.ok) {
      setText("");
      load();
    } else toast("Could not send.", false);
  }

  async function update(patch: any) {
    const r = await fetch("/api/admin/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast("Deal updated.");
      load();
    } else toast(j.error || "Update failed.", false);
  }

  if (!data) return <div className="p-4 text-sm text-[#7fbd97]">Loading deal…</div>;
  const { deal, need, application } = data;
  const sideMsgs = data.messages.filter((m: any) => m.side === side);
  const peer = side === "buyer" ? deal.buyer : deal.seller;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/admin/deals" className="text-sm font-bold text-neon">← All deals</Link>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* manage */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
            <div className="flex items-center justify-between">
              <b className="text-white">#{deal.id}</b>
              <StatusBadge status={deal.status} />
            </div>
            <div className="mt-1 text-sm text-[#b9e6c9]">{deal.title}</div>
            {need && <div className="mt-2 rounded-xl border border-[#134e32] bg-[#061b12] p-2.5 text-xs text-[#b9e6c9]">📝 {need.title}<br />{need.description?.slice(0, 120)}…</div>}
            {application && (
              <div className="mt-2 rounded-xl border border-[#134e32] bg-[#061b12] p-2.5 text-xs text-[#b9e6c9]">
                💰 Offer {fmtMoney(application.price)} · ⏱ {application.deliveryTime}
                <br />“{application.message}”
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-[#00e676]/25 bg-[#061b12] p-4 text-white">
            <div className="text-xs font-black uppercase tracking-widest text-[#4d7a5f]">Parties (admin only)</div>
            <div className="mt-2 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <Avatar name={deal.buyer?.name || "?"} color={deal.buyer?.avatarColor || "#333"} size={26} />
                <div><b>Buyer:</b> {deal.buyer?.name}<div className="text-[#7fbd97]">{deal.buyer?.country}</div></div>
              </div>
              <div className="flex items-center gap-2">
                <Avatar name={deal.seller?.name || "?"} color={deal.seller?.avatarColor || "#333"} size={26} />
                <div><b>Seller:</b> {deal.seller?.name}<div className="text-[#7fbd97]">{deal.seller?.country}</div></div>
              </div>
            </div>
            <div className="mt-2 rounded-lg border border-[#134e32] bg-[#04120b] p-2 text-[11px] text-[#7fbd97]">
              ⚠️ Never share one party’s contact with the other.
            </div>
          </div>
          <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
            <div className="text-sm font-extrabold text-white">Manage deal</div>
            <div className="mt-2 space-y-2">
              <Field label="Status">
                <select value={deal.status} onChange={(e) => update({ status: e.target.value })} className={inputCls}>
                  {DEAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Payment">
                  <select value={deal.paymentStatus} onChange={(e) => update({ paymentStatus: e.target.value })} className={inputCls}>
                    <option>Pending</option><option>Received</option><option>Refunded</option>
                  </select>
                </Field>
                <Field label="Delivery">
                  <select value={deal.deliveryStatus} onChange={(e) => update({ deliveryStatus: e.target.value })} className={inputCls}>
                    <option>Pending</option><option>In Progress</option><option>Delivered</option>
                  </select>
                </Field>
              </div>
              <Field label="Agreed price ($)">
                <div className="flex gap-2">
                  <input type="number" min="1" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className={inputCls} />
                  <button onClick={() => update({ agreedPrice: Number(editPrice) })} className="shrink-0 rounded-xl bg-[#0d2f22] px-3 text-xs font-bold text-neon hover:bg-[#134e32]">Save</button>
                </div>
              </Field>
              <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[#134e32] bg-[#061b12] p-2 text-center text-[11px] text-[#7fbd97]">
                <div>Agreed<div className="font-extrabold text-white">{fmtMoney(deal.agreedPrice)}</div></div>
                <div>Fee<div className="font-extrabold text-white">{fmtMoney(deal.commission)}</div></div>
                <div>Total<div className="font-extrabold text-white">{fmtMoney(deal.finalAmount)}</div></div>
              </div>
            </div>
          </div>
        </div>

        {/* dual chat */}
        <div className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-1.5 rounded-full border border-[#134e32] bg-[#0a251b] p-1.5">
            {(["buyer", "seller"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={cx("rounded-full py-2.5 text-sm font-black transition", side === s ? "bg-neon text-[#04120b]" : "text-[#7fbd97]")}
              >
                {s === "buyer" ? `👤 Buyer chat` : `🏪 Seller chat`}
              </button>
            ))}
          </div>
          <div className="mt-3 flex min-h-[55vh] flex-col overflow-hidden rounded-2xl border border-[#134e32] bg-[#0a251b]">
            <div className="flex items-center gap-3 border-b border-[#134e32] bg-[#061b12] px-4 py-3">
              <Avatar name={peer?.name || "?"} color={peer?.avatarColor || "#333"} size={36} />
              <div className="leading-tight">
                <div className="text-sm font-extrabold text-white">
                  {side === "buyer" ? "BUYER CHAT" : "SELLER CHAT"} · {peer?.name}
                </div>
                <div className="text-[11px] text-[#7fbd97]">
                  {side === "buyer" ? "Buyer ↔ NEVX Admin (seller can't see this)" : "Seller ↔ NEVX Admin (buyer can't see this)"}
                </div>
              </div>
            </div>
            <div className="slim-scroll max-h-[45vh] flex-1 space-y-2.5 overflow-y-auto bg-[#04120b] p-4">
              {sideMsgs.length === 0 && (
                <p className="py-8 text-center text-sm text-[#4d7a5f]">No messages on this side yet.</p>
              )}
              {sideMsgs.map((m: any) => {
                const fromAdmin = m.sender === "admin";
                return (
                  <div key={m.id} className={cx("flex", fromAdmin ? "justify-end" : "justify-start")}>
                    <div className={cx("max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm",
                      fromAdmin ? "rounded-br-md bg-neon text-[#04120b]" : "rounded-bl-md border border-[#134e32] bg-[#0a251b] text-[#eafff2]")}>
                      {!fromAdmin && <div className="mb-0.5 text-[11px] font-bold text-neon">{peer?.name}</div>}
                      <div>{m.text}</div>
                      <div className={cx("mt-1 text-right text-[10px]", fromAdmin ? "text-[#04120b]/60" : "text-[#4d7a5f]")}>{timeAgo(m.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>
            <div className="flex gap-2 border-t border-[#134e32] p-3">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={`Message ${side} as NEVX Admin…`}
                className="flex-1 rounded-full border border-[#134e32] bg-[#061b12] px-4 py-2.5 text-sm text-white outline-none placeholder:text-[#4d7a5f] focus:border-[#00e676]/60"
                maxLength={1000}
              />
              <YellowButton onClick={send} disabled={busy || !text.trim()}>➤ Send</YellowButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
