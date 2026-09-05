"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Empty, StatusBadge } from "@/components/ui";
import { fmtMoney, timeAgo } from "@/lib/utils";

export default function DealsPage() {
  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/deals/mine")
      .then((r) => r.json())
      .then((j) => setDeals(j.deals || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <h1 className="px-1 text-xl font-black text-white">🤝 My Deals</h1>
      <div className="rounded-2xl border border-[#00e676]/25 bg-[#061b12] px-4 py-3 text-xs leading-relaxed text-[#b9e6c9]">
        🛡️ Every deal is handled by <b className="text-neon">NEVX Admin</b>. Chat with admin inside
        each deal — the other party’s contact details are never shared.
      </div>
      {loading ? (
        <div className="p-6 text-sm text-[#7fbd97]">Loading…</div>
      ) : deals.length === 0 ? (
        <Empty icon="🤝" title="No deals yet" sub="When admin selects an application, your deal appears here." />
      ) : (
        deals.map((d) => (
          <Link
            key={d.id}
            href={`/app/deals/${d.id}`}
            className="anim-fade-up block rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 transition hover:border-[#00e676]/50 sm:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-white">
                DEAL #{d.id}
                <span className="ml-2 rounded-full border border-[#134e32] bg-[#0d2f22] px-2 py-0.5 text-[10px] font-bold uppercase text-[#7fbd97]">
                  {d.role}
                </span>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <div className="mt-1 text-sm text-[#b9e6c9]">{d.title}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              {[
                ["Agreed", fmtMoney(d.agreedPrice)],
                ["Payment", d.paymentStatus],
                ["Delivery", d.deliveryStatus],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-[#134e32] bg-[#061b12] p-2">
                  <div className="text-[#4d7a5f]">{k}</div>
                  <div className="font-extrabold text-white">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-bold text-neon">💬 Chat with NEVX Admin →</span>
              <span className="text-[#4d7a5f]">{timeAgo(d.updatedAt)}</span>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
