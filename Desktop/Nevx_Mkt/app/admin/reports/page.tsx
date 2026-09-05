"use client";

import { useEffect, useState } from "react";
import { Empty, toast } from "@/components/ui";
import { cx, timeAgo } from "@/lib/utils";

export default function AdminReports() {
  const [reports, setReports] = useState<any[]>([]);

  async function load() {
    const r = await fetch("/api/admin/manage?scope=reports").then((x) => x.json());
    setReports(r.reports || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function resolve(id: string, decision: string) {
    await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "report-resolve", id, decision }),
    });
    toast("Report updated.");
    load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <h1 className="text-xl font-black text-white">🚩 Reports</h1>
      {reports.length === 0 ? (
        <Empty icon="🚩" title="No reports" sub="User reports appear here." />
      ) : (
        reports.map((r) => (
          <div key={r.id} className="anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
            <div className="flex items-center justify-between gap-2">
              <b className="text-sm text-white">🚩 {r.reason}</b>
              <span className={cx("rounded-full px-2.5 py-1 text-[10px] font-bold",
                r.status === "OPEN" ? "bg-red-100 text-red-700" : r.status === "RESOLVED" ? "bg-emerald-100 text-emerald-700" : "bg-[#0d2f22] text-[#7fbd97]")}>
                {r.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-[#7fbd97]">
              {r.targetType}: <b className="text-white">{r.target}</b> · reported by {r.reporter} · {timeAgo(r.createdAt)}
            </div>
            {r.details && <p className="mt-1 text-sm text-[#b9e6c9]">“{r.details}”</p>}
            {r.status === "OPEN" && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => resolve(r.id, "resolve")} className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700">✓ Resolve</button>
                <button onClick={() => resolve(r.id, "dismiss")} className="rounded-lg bg-[#0d2f22] px-3 py-1.5 text-xs font-bold text-[#b9e6c9] hover:bg-[#134e32]">Dismiss</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
