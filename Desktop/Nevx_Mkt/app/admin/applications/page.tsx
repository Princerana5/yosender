"use client";

import { useEffect, useState } from "react";
import { Avatar, Empty, Modal, Field, YellowButton, GhostButton, inputCls, toast } from "@/components/ui";
import { cx, fmtMoney, timeAgo } from "@/lib/utils";

const pillCls =
  "rounded-xl border border-[#134e32] bg-[#0a251b] p-2.5";

export default function AdminApplications() {
  const [apps, setApps] = useState<any[]>([]);
  const [filter, setFilter] = useState("PENDING");
  const [dealFor, setDealFor] = useState<any>(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/admin/applications").then((x) => x.json());
    setApps(r.applications || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function act(id: string, action: string, agreedPrice?: number) {
    setBusy(true);
    const r = await fetch("/api/admin/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, agreedPrice }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      toast(action === "deal" ? `Deal ${j.deal.id} created. 🤝` : action === "approve" ? "Application approved." : "Application rejected.");
      setDealFor(null);
      load();
    } else toast(j.error || "Action failed.", false);
  }

  const list = apps.filter((a) => (filter === "ALL" ? true : a.status === filter));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black text-white">📥 Applications</h1>
        <div className="flex gap-1.5 rounded-full border border-[#134e32] bg-[#0a251b] p-1">
          {["PENDING", "APPROVED", "REJECTED", "ALL"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cx(
                "rounded-full px-3 py-1.5 text-xs font-black",
                filter === f ? "bg-neon text-[#04120b]" : "text-[#7fbd97]"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <Empty icon="📥" title="Nothing here" sub={`No ${filter.toLowerCase()} applications.`} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((a) => (
            <div key={a.id} className="anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 sm:p-5">
              <div className="text-sm font-extrabold text-white">
                📝 {a.need?.title} <span className="font-medium text-[#4d7a5f]">({a.need?.category})</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className={pillCls}>
                  <div className="text-[10px] font-black uppercase text-[#4d7a5f]">Requester</div>
                  {a.requester && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <Avatar name={a.requester.name} color={a.requester.avatarColor} size={24} />
                      <div className="text-xs font-bold text-white">{a.requester.name}<div className="font-medium text-[#7fbd97]">{a.requester.country}</div></div>
                    </div>
                  )}
                </div>
                <div className={pillCls}>
                  <div className="text-[10px] font-black uppercase text-[#4d7a5f]">Applicant</div>
                  {a.applicant && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <Avatar name={a.applicant.name} color={a.applicant.avatarColor} size={24} />
                      <div className="text-xs font-bold text-white">{a.applicant.name}<div className="font-medium text-[#7fbd97]">{a.applicant.country} · ⭐ {a.applicant.rating || "new"}</div></div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 rounded-xl border border-[#134e32] bg-[#061b12] p-3 text-sm text-[#b9e6c9]">“{a.message}”</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#7fbd97]">
                <b className="text-white">💰 {fmtMoney(a.price)}</b>
                <span>⏱ {a.deliveryTime}</span>
                <span>· {timeAgo(a.createdAt)}</span>
                <span className={cx("ml-auto rounded-full px-2.5 py-1 text-[10px] font-bold",
                  a.status === "PENDING" ? "bg-amber-100 text-amber-800" : a.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                  {a.status}
                </span>
              </div>
              {a.status === "PENDING" && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <YellowButton disabled={busy} onClick={() => { setDealFor(a); setPrice(String(a.price)); }} className="!px-2">
                    🤝 Deal
                  </YellowButton>
                  <GhostButton disabled={busy} onClick={() => act(a.id, "approve")} className="!px-2 !text-emerald-400">
                    ✓ Approve
                  </GhostButton>
                  <GhostButton disabled={busy} onClick={() => act(a.id, "reject")} className="!px-2 !text-red-400">
                    ✕ Reject
                  </GhostButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!dealFor} onClose={() => setDealFor(null)} title="Create deal 🤝">
        {dealFor && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#134e32] bg-[#061b12] p-3 text-sm text-[#b9e6c9]">
              <b className="text-white">{dealFor.need?.title}</b>
              <div className="text-xs text-[#7fbd97]">
                {dealFor.requester?.name} ← admin → {dealFor.applicant?.name}
              </div>
            </div>
            <Field label="Agreed price ($)" hint="8% admin commission is added on top.">
              <input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
            </Field>
            <YellowButton disabled={busy} className="w-full" onClick={() => act(dealFor.id, "deal", Number(price))}>
              {busy ? "Creating…" : "Create deal & notify both parties"}
            </YellowButton>
          </div>
        )}
      </Modal>
    </div>
  );
}
