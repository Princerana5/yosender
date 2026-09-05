"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, StatusBadge } from "@/components/ui";
import { fmtMoney, timeAgo } from "@/lib/utils";

export default function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/admin/overview").then((r) => r.json()).then(setData);
  }, []);
  if (!data) return <div className="p-4 text-sm text-[#7fbd97]">Loading dashboard…</div>;
  const s = data.stats;

  const cards = [
    { l: "Total Users", v: s.totalUsers, i: "👥" },
    { l: "Active Users", v: s.activeUsers, i: "🟢" },
    { l: "Total Needs", v: s.totalNeeds, i: "📝" },
    { l: "Total Offers", v: s.totalOffers, i: "🏷️" },
    { l: "Pending Applications", v: s.pendingApplications, i: "📥" },
    { l: "Active Deals", v: s.activeDeals, i: "🤝" },
    { l: "Completed Deals", v: s.completedDeals, i: "✅" },
    { l: "Cancelled Deals", v: s.cancelledDeals, i: "❌" },
    { l: "Commission Revenue", v: fmtMoney(s.revenue), i: "💰" },
    { l: "Open Reports", v: s.openReports, i: "🚩" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-white">📊 Dashboard</h1>
        <Link href="/app" className="text-xs font-bold text-neon hover:underline">
          View marketplace →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.l} className="anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 transition hover:border-[#00e676]/50">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[#00e676]/10 text-xl">{c.i}</div>
            <div className="mt-2 text-xl font-black text-white">{c.v}</div>
            <div className="text-[11px] font-semibold text-[#7fbd97]">{c.l}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-white">📥 Latest applications</h2>
            <Link href="/admin/applications" className="text-xs font-bold text-neon">View all →</Link>
          </div>
          <div className="mt-3 space-y-2">
            {data.recentApplications.map((a: any) => (
              <Link key={a.id} href="/admin/applications" className="flex items-center gap-2.5 rounded-xl border border-[#134e32] bg-[#061b12] p-2.5 hover:border-[#00e676]/40">
                {a.applicant && <Avatar name={a.applicant.name} color={a.applicant.avatarColor} size={30} />}
                <div className="min-w-0 flex-1 text-xs text-[#b9e6c9]">
                  <b className="text-white">{a.applicant?.name}</b> → {a.need?.title}
                  <div className="text-[#7fbd97]">{fmtMoney(a.price)} · {timeAgo(a.createdAt)}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${a.status === "PENDING" ? "bg-amber-100 text-amber-800" : a.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {a.status}
                </span>
              </Link>
            ))}
            {data.recentApplications.length === 0 && (
              <p className="py-6 text-center text-sm text-[#4d7a5f]">No applications yet.</p>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-white">🤝 Active deals</h2>
            <Link href="/admin/deals" className="text-xs font-bold text-neon">View all →</Link>
          </div>
          <div className="mt-3 space-y-2">
            {data.activeDealsList.map((d: any) => (
              <Link key={d.id} href={`/admin/deals/${d.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-[#134e32] bg-[#061b12] p-2.5 hover:border-[#00e676]/40">
                <div className="text-xs text-[#b9e6c9]">
                  <b className="text-white">#{d.id}</b> · {d.title}
                  <div className="text-[#7fbd97]">{fmtMoney(d.agreedPrice)} · {timeAgo(d.updatedAt)}</div>
                </div>
                <StatusBadge status={d.status} />
              </Link>
            ))}
            {data.activeDealsList.length === 0 && (
              <p className="py-6 text-center text-sm text-[#4d7a5f]">No active deals.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
