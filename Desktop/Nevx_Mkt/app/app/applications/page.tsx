"use client";

import { useEffect, useState } from "react";
import { Avatar, Empty } from "@/components/ui";
import { cx, fmtMoney, timeAgo } from "@/lib/utils";

function pill(s: string) {
  return s === "APPROVED"
    ? "bg-emerald-100 text-emerald-700"
    : s === "REJECTED"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-800";
}

export default function ApplicationsPage() {
  const [tab, setTab] = useState<"sent" | "received">("sent");
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/mine").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="p-6 text-sm text-[#7fbd97]">Loading…</div>;
  const list = tab === "sent" ? data.myApplications : data.received;

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <h1 className="px-1 text-xl font-black text-white">📥 Applications</h1>
      <div className="grid grid-cols-2 gap-1.5 rounded-full border border-[#134e32] bg-[#0a251b] p-1.5">
        {(["sent", "received"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "rounded-full py-2 text-sm font-black transition",
              tab === t ? "bg-neon text-[#04120b]" : "text-[#7fbd97]"
            )}
          >
            {t === "sent" ? `Sent (${data.myApplications.length})` : `Received (${data.received.length})`}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty
          icon="📥"
          title={tab === "sent" ? "No applications sent" : "No applications received"}
          sub={
            tab === "sent"
              ? "Apply to any need from the Home feed."
              : "When sellers apply to your needs, they appear here (admin reviews them)."
          }
        />
      ) : (
        list.map((a: any) => (
          <div key={a.id} className="anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-extrabold text-white">{a.need?.title}</div>
              <span className={cx("rounded-full px-2.5 py-1 text-[11px] font-bold", pill(a.status))}>
                {a.status}
              </span>
            </div>
            {tab === "received" && a.applicant && (
              <div className="mt-2 flex items-center gap-2">
                <Avatar name={a.applicant.name} color={a.applicant.avatarColor} size={28} />
                <span className="text-xs font-bold text-[#b9e6c9]">
                  {a.applicant.name} · {a.applicant.country} · ⭐ {a.applicant.rating || "new"}
                </span>
              </div>
            )}
            {tab === "sent" && a.requester && (
              <div className="mt-1 text-xs text-[#7fbd97]">
                Request by {a.requester.name} · {a.requester.country}
              </div>
            )}
            <div className="mt-2 rounded-xl border border-[#134e32] bg-[#061b12] p-3 text-sm text-[#b9e6c9]">“{a.message}”</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#7fbd97]">
              <span className="font-bold text-white">💰 {fmtMoney(a.price)}</span>
              <span>⏱ {a.deliveryTime}</span>
              <span>· {timeAgo(a.createdAt)}</span>
            </div>
            {a.status === "PENDING" && (
              <p className="mt-2 text-[11px] text-amber-300">
                ⏳ Under review by NEVX Admin — you’ll be notified of the decision.
              </p>
            )}
            {a.status === "APPROVED" && (
              <p className="mt-2 text-[11px] font-bold text-neon">
                ✅ Selected! NEVX Admin will create your deal shortly.
              </p>
            )}
          </div>
        ))
      )}
      <div className="rounded-2xl border border-[#00e676]/25 bg-[#061b12] p-4 text-center text-[11px] leading-relaxed text-[#7fbd97]">
        🔒 Applications go to NEVX Admin only. Requesters and applicants never exchange contact details.
      </div>
    </div>
  );
}
