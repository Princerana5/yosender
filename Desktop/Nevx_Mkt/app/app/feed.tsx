"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NeedCard, OfferCard, type NeedItem, type OfferItem } from "@/components/cards";
import { NeedForm, OfferForm, AuthWall } from "@/components/forms";
import { Empty, Modal, YellowButton, GhostButton, groupEmoji, inputCls } from "@/components/ui";
import { cx } from "@/lib/utils";

type Tab = "needs" | "sell";

export default function Feed({
  groups,
  categories,
  me,
  initialGroup,
}: {
  groups: any[];
  categories: any[];
  me: any;
  initialGroup: string;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const groupId = search.get("group") || initialGroup;
  const group = groups.find((g) => g.id === groupId) || groups[0];

  const [tab, setTab] = useState<Tab>("needs");
  const [needs, setNeeds] = useState<NeedItem[]>([]);
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [postMode, setPostMode] = useState<"need" | "offer" | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        group: group?.id || "",
        q: debouncedQ,
        category,
        sort,
      });
      const [rn, ro] = await Promise.all([
        fetch(`/api/needs?${params}`).then((r) => r.json()),
        fetch(`/api/offers?${params}`).then((r) => r.json()),
      ]);
      setNeeds(rn.needs || []);
      setOffers(ro.offers || []);
    } catch {
      /* offline */
    }
    setLoading(false);
  }, [group?.id, debouncedQ, category, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => (tab === "needs" ? needs : offers), [tab, needs, offers]);

  function switchGroup(id: string) {
    router.push(`/app?group=${id}`);
  }

  return (
    <div className="mx-auto max-w-6xl gap-4 p-3 sm:p-4 lg:flex">
      {/* MAIN COLUMN (~90% behavior via tab state, animated) */}
      <div className="min-w-0 flex-1">
        {/* search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4d7a5f]">🔍</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search needs, offers, categories…"
              className="w-full rounded-full border border-[#134e32] bg-[#0a251b] py-3 pl-10 pr-4 text-sm text-white shadow-sm outline-none placeholder:text-[#4d7a5f] focus:border-[#00e676]/60 focus:ring-2 focus:ring-[#00e676]/20"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cx(
              "grid w-12 shrink-0 place-items-center rounded-full border border-[#134e32] bg-[#0a251b] text-lg",
              showFilters ? "border-[#00e676]/60 ring-2 ring-[#00e676]/20" : ""
            )}
            title="Filters"
          >
            🎚️
          </button>
        </div>

        {/* filters */}
        {showFilters && (
          <div className="anim-fade-up mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-[#134e32] bg-[#0a251b] p-3 sm:grid-cols-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className={inputCls}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="popular">Most applications</option>
            </select>
            <button
              onClick={() => { setCategory(""); setSort("newest"); setQ(""); }}
              className="rounded-xl bg-[#0d2f22] px-3 py-2 text-sm font-bold text-[#b9e6c9] hover:bg-[#134e32]"
            >
              Clear
            </button>
          </div>
        )}

        {/* group header */}
        <div className="mt-3 overflow-hidden rounded-2xl border border-[#00e676]/25 bg-[#061b12] p-4 shadow-[0_0_40px_rgba(0,230,118,0.08)] sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#00e676]/12 text-2xl ring-1 ring-[#00e676]/40">
              {groupEmoji(group?.code)}
            </span>
            <div>
              <h1 className="text-xl font-black tracking-wide text-white">{group?.name}</h1>
              <p className="text-xs text-[#7fbd97]">
                {needs.length} needs · {offers.length} offers
              </p>
            </div>
          </div>
          {/* 90% switcher */}
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-full border border-[#134e32] bg-[#04120b] p-1.5">
            {(["needs", "sell"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cx(
                  "rounded-full py-2.5 text-sm font-black uppercase tracking-wide transition-all",
                  tab === t
                    ? "bg-neon text-[#04120b] shadow-[0_0_18px_rgba(0,230,118,0.45)]"
                    : "text-[#7fbd97] hover:text-white"
                )}
              >
                {t === "needs" ? `📝 Needs (${needs.length})` : `🏷️ Sell / Offer (${offers.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* CTA row */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <YellowButton onClick={() => setPostMode("need")}>🙋 I need something</YellowButton>
          <GhostButton onClick={() => setPostMode("offer")}>
            🏷️ I want to sell / offer
          </GhostButton>
        </div>

        {/* feed */}
        <div key={tab + groupId} className="feed-transition mt-3 space-y-3">
          {loading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-[#134e32] bg-[#0a251b] p-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-[#134e32]" />
                  <div className="h-4 w-40 rounded bg-[#134e32]" />
                </div>
                <div className="mt-3 h-4 w-3/4 rounded bg-[#134e32]" />
                <div className="mt-2 h-4 w-1/2 rounded bg-[#0d2f22]" />
              </div>
            ))
          ) : visible.length === 0 ? (
            <Empty
              icon={tab === "needs" ? "📝" : "🏷️"}
              title={tab === "needs" ? "No needs here yet" : "No offers here yet"}
              sub={
                tab === "needs"
                  ? "Be the first to post what you need in this group."
                  : "Be the first to post an offer in this group."
              }
            />
          ) : tab === "needs" ? (
            (visible as NeedItem[]).map((n) => (
              <NeedCard key={n.id} need={n} mine={n.author?.id === me.id} onApplied={load} />
            ))
          ) : (
            (visible as OfferItem[]).map((o) => <OfferCard key={o.id} offer={o} />)
          )}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <aside className="mt-4 hidden w-72 shrink-0 space-y-3 lg:mt-0 lg:block">
        <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#4d7a5f]">Groups</div>
          <div className="mt-2 space-y-1">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => switchGroup(g.id)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-bold transition",
                  g.id === groupId ? "bg-[#00e676]/12 text-neon ring-1 ring-[#00e676]/30" : "text-[#b9e6c9] hover:bg-[#0d2f22]"
                )}
              >
                <span className="text-lg">{groupEmoji(g.code)}</span>
                {g.name}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-[#00e676]/25 bg-[#061b12] p-4 text-white shadow-[0_0_30px_rgba(0,230,118,0.08)]">
          <div className="text-sm font-extrabold text-neon">🛡️ How deals work</div>
          <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-[#b9e6c9]">
            <li>1. You post a need</li>
            <li>2. Sellers apply via admin</li>
            <li>3. Admin verifies & mediates</li>
            <li>4. Payment + delivery via admin</li>
          </ol>
          <div className="mt-3 rounded-xl border border-[#134e32] bg-[#04120b] p-2.5 text-[11px] text-[#7fbd97]">
            🔒 Buyer ↔ Admin ↔ Seller. Direct contact is never shared.
          </div>
        </div>
        <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
          <div className="text-sm font-extrabold text-white">💬 Support</div>
          <p className="mt-1 text-xs text-[#7fbd97]">Questions about a deal? NEVX admin replies fast.</p>
          <button
            onClick={() => (window.location.href = "/app/deals")}
            className="mt-2 w-full rounded-full border border-[#00e676]/40 bg-[#00e676]/10 py-2 text-xs font-bold text-neon hover:bg-[#00e676]/20"
          >
            Chat with NEVX Admin
          </button>
        </div>
      </aside>

      {/* post modals */}
      <Modal open={postMode !== null} onClose={() => setPostMode(null)} title={postMode === "need" ? "Post a Need 🙋" : "Sell / Offer 🏷️"} wide>
        {me ? (
          postMode === "need" ? (
            <NeedForm groups={groups} categories={categories} defaultGroup={groupId} userCountry={me.country} onDone={() => { setPostMode(null); setTab("needs"); load(); }} />
          ) : (
            <OfferForm groups={groups} categories={categories} defaultGroup={groupId} userCountry={me.country} onDone={() => { setPostMode(null); setTab("sell"); load(); }} />
          )
        ) : (
          <AuthWall mode={postMode === "need" ? "need" : "offer"} />
        )}
      </Modal>
    </div>
  );
}
