"use client";

import { useEffect, useState } from "react";
import { Empty, inputCls, toast } from "@/components/ui";
import { cx, fmtMoney, timeAgo } from "@/lib/utils";

export default function AdminRequests() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"need" | "offer">("need");
  const [groups, setGroups] = useState<any[]>([]);
  const [moveFor, setMoveFor] = useState<any>(null);

  async function load() {
    const r = await fetch("/api/admin/manage?scope=requests").then((x) => x.json());
    setData(r);
    const m = await fetch("/api/meta").then((x) => x.json());
    setGroups(m.groups || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(kind: string, id: string, status: string) {
    const r = await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "post-status", kind, id, status }),
    });
    if (r.ok) {
      toast("Post updated.");
      load();
    } else toast("Failed.", false);
  }

  async function move(groupId: string) {
    if (!moveFor) return;
    const r = await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "move-post", kind: moveFor.kind, id: moveFor.id, groupId }),
    });
    if (r.ok) {
      toast("Post moved.");
      setMoveFor(null);
      load();
    } else toast("Failed.", false);
  }

  if (!data) return <div className="p-4 text-sm text-[#7fbd97]">Loading…</div>;
  const list = tab === "need" ? data.needs : data.offers;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black text-white">📝 Needs & Offers</h1>
        <div className="flex gap-1.5 rounded-full border border-[#134e32] bg-[#0a251b] p-1">
          {(["need", "offer"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cx("rounded-full px-4 py-1.5 text-xs font-black", tab === t ? "bg-neon text-[#04120b]" : "text-[#7fbd97]")}>
              {t === "need" ? `NEEDS (${data.needs.length})` : `OFFERS (${data.offers.length})`}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <Empty icon="📝" title="Nothing here" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((p: any) => (
            <div key={p.id} className="anim-fade-up rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
              <div className="flex items-start justify-between gap-2">
                <b className="text-sm text-white">{p.title}</b>
                <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  p.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : p.status === "HIDDEN" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700")}>
                  {p.status}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-[#7fbd97]">{p.description}</p>
              <div className="mt-1 text-[11px] text-[#4d7a5f]">
                {p.category} · {tab === "need" ? (p.budgetMin ? fmtMoney(p.budgetMin) : "Negotiable") : fmtMoney(p.price)} · {p.country} · {timeAgo(p.createdAt)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["ACTIVE", "HIDDEN", "DELETED"].map((st) => (
                  <button key={st} onClick={() => setStatus(tab, p.id, st)}
                    className={cx("rounded-lg px-2.5 py-1 text-[11px] font-bold",
                      p.status === st ? "bg-neon text-[#04120b]" : "bg-[#0d2f22] text-[#b9e6c9] hover:bg-[#134e32]")}>
                    {st}
                  </button>
                ))}
                <button onClick={() => setMoveFor({ kind: tab, id: p.id, title: p.title })}
                  className="rounded-lg border border-[#00e676]/30 bg-[#00e676]/10 px-2.5 py-1 text-[11px] font-bold text-neon hover:bg-[#00e676]/20">
                  ⇄ Move group
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {moveFor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setMoveFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="anim-pop w-full max-w-sm rounded-2xl border border-[#134e32] bg-[#0a251b] p-5">
            <h3 className="font-extrabold text-white">Move “{moveFor.title}”</h3>
            <select id="mv" className={`${inputCls} mt-3`}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button
              onClick={() => move((document.getElementById("mv") as HTMLSelectElement).value)}
              className="mt-3 w-full rounded-full bg-neon py-2.5 text-sm font-black text-[#04120b]">
              Move post
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
