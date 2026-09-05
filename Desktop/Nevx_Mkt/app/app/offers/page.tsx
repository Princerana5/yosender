"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Empty, StatusBadge } from "@/components/ui";
import { timeAgo, fmtMoney } from "@/lib/utils";

export default function MyOffers() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/mine").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="p-6 text-sm text-[#7fbd97]">Loading…</div>;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <h1 className="px-1 text-xl font-black text-white">🏷️ My Offers</h1>
      {data.myOffers.length === 0 ? (
        <Empty icon="🏷️" title="No offers yet" sub="Post your first offer from the Home feed Sell tab." />
      ) : (
        data.myOffers.map((o: any) => (
          <div key={o.id} className="anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-extrabold uppercase text-white">{o.title}</h3>
              <StatusBadge status={o.status === "ACTIVE" ? "In Progress" : o.status} />
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-[#b9e6c9]">{o.description}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[#00e676]/25 bg-[#00e676]/10 px-2.5 py-1 font-bold text-neon">{o.category}</span>
              <span className="rounded-full border border-[#134e32] bg-[#0d2f22] px-2.5 py-1 font-bold text-[#b9e6c9]">
                💰 {o.priceType === "from" ? `from ${fmtMoney(o.price)}` : fmtMoney(o.price)}
              </span>
              <span className="rounded-full border border-[#134e32] bg-[#0d2f22] px-2.5 py-1 font-semibold text-[#b9e6c9]">
                {timeAgo(o.createdAt)}
              </span>
            </div>
          </div>
        ))
      )}
      <Link href="/app" className="block text-center text-sm font-bold text-neon">
        ← Back to marketplace
      </Link>
    </div>
  );
}
