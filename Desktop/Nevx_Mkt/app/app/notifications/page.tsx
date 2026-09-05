"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Empty } from "@/components/ui";
import { cx, timeAgo } from "@/lib/utils";

export default function NotificationsPage() {
  const [data, setData] = useState<any>(null);

  async function load() {
    const r = await fetch("/api/mine").then((x) => x.json());
    setData(r);
  }
  useEffect(() => {
    load();
  }, []);

  async function markAll() {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    load();
  }

  if (!data) return <div className="p-6 text-sm text-[#7fbd97]">Loading…</div>;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-black text-white">🔔 Notifications</h1>
        {data.unread > 0 && (
          <button onClick={markAll} className="text-xs font-bold text-neon hover:underline">
            Mark all read
          </button>
        )}
      </div>
      {data.notifications.length === 0 ? (
        <Empty icon="🔔" title="All caught up" sub="Applications, deals and admin messages appear here." />
      ) : (
        data.notifications.map((n: any) => (
          <Link
            key={n.id}
            href={n.link || "/app"}
            onClick={() => {
              fetch("/api/notifications/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: n.id }),
              });
            }}
            className={cx(
              "anim-fade-up flex items-start gap-3 rounded-2xl border p-4 transition",
              n.read
                ? "border-[#134e32] bg-[#0a251b]"
                : "border-[#00e676]/40 bg-[#00e676]/8 shadow-[0_0_24px_rgba(0,230,118,0.1)]"
            )}
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#00e676]/12 text-xl ring-1 ring-[#00e676]/30">
              {n.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cx("text-sm", n.read ? "text-[#b9e6c9]" : "font-bold text-white")}>
                {n.text}
              </div>
              <div className="mt-0.5 text-xs text-[#4d7a5f]">{timeAgo(n.createdAt)}</div>
            </div>
            {!n.read && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-neon shadow-[0_0_10px_rgba(0,230,118,0.8)]" />}
          </Link>
        ))
      )}
    </div>
  );
}
