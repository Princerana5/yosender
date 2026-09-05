"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Empty, StatusBadge } from "@/components/ui";
import { fmtMoney, timeAgo } from "@/lib/utils";

export default function AdminDeals() {
  const [deals, setDeals] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/admin/deals").then((r) => r.json()).then((j) => setDeals(j.deals || []));
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <h1 className="text-xl font-black text-white">🤝 Deals</h1>
      {deals.length === 0 ? (
        <Empty icon="🤝" title="No deals yet" sub="Approve an application and create a deal." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {deals.map((d) => (
            <Link key={d.id} href={`/admin/deals/${d.id}`} className="anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 transition hover:border-[#00e676]/50 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm text-white">#{d.id}</b>
                <StatusBadge status={d.status} />
              </div>
              <div className="mt-1 text-sm text-[#b9e6c9]">{d.title}</div>
              <div className="mt-2 flex items-center gap-4 text-xs text-white">
                {d.buyer && (
                  <span className="flex items-center gap-1.5">
                    <Avatar name={d.buyer.name} color={d.buyer.avatarColor} size={22} />
                    <b>{d.buyer.name}</b>
                  </span>
                )}
                <span className="text-neon">⇄</span>
                {d.seller && (
                  <span className="flex items-center gap-1.5">
                    <Avatar name={d.seller.name} color={d.seller.avatarColor} size={22} />
                    <b>{d.seller.name}</b>
                  </span>
                )}
                <span className="ml-auto text-[#4d7a5f]">💬 {d.msgCount}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-[#7fbd97]">
                <b className="text-white">{fmtMoney(d.agreedPrice)} · {d.paymentStatus} · {d.deliveryStatus}</b>
                <span>{timeAgo(d.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
