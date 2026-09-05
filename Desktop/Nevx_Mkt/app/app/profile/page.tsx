"use client";

import { useEffect, useState } from "react";
import { Avatar, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export default function ProfilePage() {
  const [me, setMe] = useState<any>(null);
  const [mine, setMine] = useState<any>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => setMe(j.user));
    fetch("/api/mine").then((r) => r.json()).then(setMine);
  }, []);

  if (!me) return <div className="p-6 text-sm text-[#7fbd97]">Loading…</div>;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <div className="overflow-hidden rounded-3xl border border-[#134e32] bg-[#0a251b]">
        <div className="relative bg-[#061b12] px-6 pb-14 pt-8 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,rgba(0,230,118,0.15),transparent)]" />
          <div className="relative mx-auto w-fit rounded-full ring-4 ring-neon/60">
            <Avatar name={me.name} color={me.avatarColor} size={84} />
          </div>
          <h1 className="relative mt-3 text-xl font-black text-white">
            {me.name} {me.verified && <span className="text-neon">✔</span>}
          </h1>
          <p className="relative text-xs text-[#7fbd97]">
            {me.country} · Joined {fmtDate(me.createdAt)}
          </p>
          {me.telegram && (
            <p className="relative mt-1 text-xs font-bold text-neon">✈️ @{me.telegram}</p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 py-4 text-center">
          <Stat v={mine?.stats?.needs ?? "–"} l="Needs posted" />
          <Stat v={mine?.stats?.offers ?? "–"} l="Offers posted" />
          <Stat v={mine?.stats?.deals ?? "–"} l="Successful deals" />
        </div>
        <div className="flex items-center justify-center gap-2 border-t border-[#134e32] px-4 py-3 text-xs text-[#7fbd97]">
          <span>⭐ Rating: <b className="text-white">{me.rating || "New"} {me.ratingCount ? `(${me.ratingCount})` : ""}</b></span>
          <span>·</span>
          <span>Status: <b className="text-neon">{me.verified ? "Verified ✓" : "Unverified"}</b></span>
        </div>
        <div className="border-t border-[#134e32] bg-[#061b12] px-5 py-3 text-[11px] leading-relaxed text-[#7fbd97]">
          🔒 Your email and private details are never shown to other users. All deals run through
          NEVX Admin — nobody can bypass mediation from your profile.
        </div>
      </div>

      {mine?.activeDeals?.length > 0 && (
        <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4">
          <div className="text-sm font-extrabold text-white">⚡ Active deals</div>
          {mine.activeDeals.slice(0, 3).map((d: any) => (
            <a key={d.id} href={`/app/deals/${d.id}`} className="mt-2 block rounded-xl border border-[#134e32] bg-[#061b12] p-3 text-sm text-[#b9e6c9] hover:border-[#00e676]/40">
              <b className="text-white">#{d.id}</b> · {d.title}
              <span className="ml-2 text-xs text-neon">→ open chat</span>
            </a>
          ))}
        </div>
      )}
      {(!mine?.activeDeals || mine.activeDeals.length === 0) && (
        <Empty icon="🤝" title="No active deals" sub="Apply to needs or wait for admin to create your deal." />
      )}
    </div>
  );
}

function Stat({ v, l }: { v: any; l: string }) {
  return (
    <div className="rounded-2xl border border-[#134e32] bg-[#061b12] p-3">
      <div className="text-xl font-black text-neon">{v}</div>
      <div className="text-[11px] font-semibold text-[#7fbd97]">{l}</div>
    </div>
  );
}
