"use client";

import { useState } from "react";
import { money, PostHead, ReportButton, YellowButton, GhostButton, Modal, Field, inputCls, toast } from "./ui";
import { fmtMoney } from "@/lib/utils";

export interface NeedItem {
  id: string;
  title: string;
  description: string;
  category: string;
  budgetMin?: number;
  budgetMax?: number;
  budgetType: string;
  country: string;
  applicationCount: number;
  createdAt: number;
  author: { id: string; name: string; country: string; avatarColor: string; verified: boolean } | null;
}

export interface OfferItem {
  id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  priceType: string;
  country: string;
  deliveryTime?: string;
  createdAt: number;
  author: { id: string; name: string; country: string; avatarColor: string; verified: boolean } | null;
}

function budgetLabel(n: NeedItem): string {
  if (n.budgetType === "negotiable" || (!n.budgetMin && !n.budgetMax)) return "Negotiable";
  if (n.budgetMin && n.budgetMax && n.budgetMin !== n.budgetMax)
    return `${fmtMoney(n.budgetMin)}–${fmtMoney(n.budgetMax)}`;
  return fmtMoney(n.budgetMin ?? n.budgetMax ?? 0);
}

function priceLabel(o: OfferItem): string {
  if (o.priceType === "negotiable") return "Negotiable";
  if (o.priceType === "from") return `from ${fmtMoney(o.price)}`;
  return fmtMoney(o.price);
}

const cardCls =
  "anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 shadow-[0_8px_28px_rgba(0,0,0,0.4)] transition hover:border-[#00e676]/50 hover:shadow-[0_0_28px_rgba(0,230,118,0.12)] sm:p-5";
const chipCls =
  "rounded-full border border-[#00e676]/25 bg-[#00e676]/10 px-2.5 py-1 font-bold text-[#00e676]";
const dimChipCls =
  "rounded-full border border-[#134e32] bg-[#0d2f22] px-2.5 py-1 font-semibold text-[#b9e6c9]";

/* ---------------- NEED CARD ---------------- */
export function NeedCard({ need, mine = false, onApplied }: { need: NeedItem; mine?: boolean; onApplied?: () => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [delivery, setDelivery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!price || !delivery.trim() || !message.trim()) {
      toast("Fill price, delivery time and message.", false);
      return;
    }
    setBusy(true);
    const r = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needId: need.id, price: Number(price), deliveryTime: delivery, message }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      toast("Application submitted successfully. NEVX admin will review it.");
      onApplied?.();
    } else {
      toast(j.error || "Could not apply.", false);
    }
  }

  return (
    <article className={cardCls}>
      {need.author && (
        <PostHead
          name={need.author.name}
          color={need.author.avatarColor}
          country={need.author.country}
          createdAt={need.createdAt}
          verified={need.author.verified}
        />
      )}
      <h3 className="mt-3 text-[15px] font-extrabold uppercase tracking-wide text-white">
        {need.title}
      </h3>
      <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-[#b9e6c9]">{need.description}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className={chipCls}>{need.category}</span>
        <span className={dimChipCls}>💰 {budgetLabel(need)}</span>
        <span className={dimChipCls}>
          📥 {need.applicationCount} application{need.applicationCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {mine ? (
          <span className="text-xs font-bold text-neon">Your request</span>
        ) : (
          <YellowButton onClick={() => setOpen(true)} className="flex-1">
            Apply
          </YellowButton>
        )}
        <ReportButton targetType="need" targetId={need.id} />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Apply for this request">
        <p className="mb-1 text-xs text-[#7fbd97]">
          🔒 Your application goes to <b className="text-white">NEVX Admin</b> — never directly to the requester.
        </p>
        <div className="mb-4 rounded-xl border border-[#134e32] bg-[#061b12] p-3 text-sm">
          <div className="font-bold text-white">{need.title}</div>
          <div className="text-xs text-[#7fbd97]">Budget: {budgetLabel(need)}</div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Your price ($) ">
              <input
                type="number"
                min="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputCls}
                placeholder="350"
              />
            </Field>
            <Field label="Delivery time">
              <input
                value={delivery}
                onChange={(e) => setDelivery(e.target.value)}
                className={inputCls}
                placeholder="7 days"
              />
            </Field>
          </div>
          <Field label="Message to admin">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={inputCls}
              rows={4}
              placeholder="Why are you the right person for this?"
            />
          </Field>
          <YellowButton onClick={submit} disabled={busy} className="w-full">
            {busy ? "Submitting…" : "Submit application"}
          </YellowButton>
        </div>
      </Modal>
    </article>
  );
}

/* ---------------- OFFER CARD ---------------- */
export function OfferCard({ offer }: { offer: OfferItem }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={cardCls}>
      {offer.author && (
        <PostHead
          name={offer.author.name}
          color={offer.author.avatarColor}
          country={offer.author.country}
          createdAt={offer.createdAt}
          verified={offer.author.verified}
        />
      )}
      <h3 className="mt-3 text-[15px] font-extrabold uppercase tracking-wide text-white">
        {offer.title}
      </h3>
      <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-[#b9e6c9]">{offer.description}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className={chipCls}>{offer.category}</span>
        <span className={dimChipCls}>💰 {priceLabel(offer)}</span>
        {offer.deliveryTime && <span className={dimChipCls}>⏱ {offer.deliveryTime}</span>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <GhostButton onClick={() => setOpen(true)} className="flex-1">
          View offer
        </GhostButton>
        <ReportButton targetType="offer" targetId={offer.id} />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={offer.title}>
        {offer.author && (
          <div className="mb-3">
            <PostHead
              name={offer.author.name}
              color={offer.author.avatarColor}
              country={offer.author.country}
              createdAt={offer.createdAt}
              verified={offer.author.verified}
            />
          </div>
        )}
        <p className="text-sm leading-relaxed text-[#b9e6c9]">{offer.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className={chipCls}>{offer.category}</span>
          <span className={dimChipCls}>{money(offer.price)}</span>
        </div>
        <div className="mt-4 rounded-xl border border-[#00e676]/25 bg-[#00e676]/10 p-3 text-xs leading-relaxed text-[#b9e6c9]">
          🔒 Interested? Post your own <b className="text-white">Need</b> describing this requirement and let providers
          apply — <b className="text-white">NEVX Admin</b> mediates every deal. No direct contact is ever shared.
        </div>
      </Modal>
    </article>
  );
}
