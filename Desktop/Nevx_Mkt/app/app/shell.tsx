"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar, Logo, Toasts, groupEmoji } from "@/components/ui";
import { cx } from "@/lib/utils";

const NAV = [
  { href: "/app", label: "Home", icon: "🏠", exact: true },
  { href: "/app/requests", label: "My Requests", icon: "📝" },
  { href: "/app/offers", label: "My Offers", icon: "🏷️" },
  { href: "/app/applications", label: "Applications", icon: "📥" },
  { href: "/app/deals", label: "Deals", icon: "🤝" },
  { href: "/app/notifications", label: "Notifications", icon: "🔔" },
  { href: "/app/profile", label: "Profile", icon: "👤" },
  { href: "/app/settings", label: "Settings", icon: "⚙️" },
];

export default function AppShell({
  children,
  me,
  unread,
  activeDeals,
  groups,
}: {
  children: React.ReactNode;
  me: any;
  unread: number;
  activeDeals: number;
  groups: any[];
}) {
  const path = usePathname();
  const router = useRouter();
  const [mobileNav, setMobileNav] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || path.startsWith(href + "/");

  const sidebar = (
    <div className="flex h-full flex-col bg-[#04120b]">
      <Link href="/app" className="px-4 pb-3 pt-4">
        <Logo />
      </Link>
      <nav className="slim-scroll flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setMobileNav(false)}
            className={cx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              isActive(n.href, n.exact)
                ? "bg-neon font-bold text-[#04120b] shadow-[0_0_18px_rgba(0,230,118,0.35)]"
                : "text-[#b9e6c9] hover:bg-[#0d2f22]"
            )}
          >
            <span className="text-lg">{n.icon}</span>
            {n.label}
            {n.label === "Notifications" && unread > 0 && (
              <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">
                {unread}
              </span>
            )}
            {n.label === "Deals" && activeDeals > 0 && (
              <span className="ml-auto rounded-full bg-[#0d2f22] px-2 py-0.5 text-[11px] font-bold text-neon ring-1 ring-[#00e676]/40">
                {activeDeals}
              </span>
            )}
          </Link>
        ))}

        {me.role !== "USER" && (
          <Link
            href="/admin"
            className="mt-1 flex items-center gap-3 rounded-xl border border-[#00e676]/30 bg-[#00e676]/10 px-3 py-2.5 text-sm font-bold text-neon transition hover:bg-[#00e676]/20"
          >
            <span className="text-lg">🛡️</span>
            Admin Panel
          </Link>
        )}

        <div className="px-3 pb-1 pt-4 text-[11px] font-black uppercase tracking-widest text-[#4d7a5f]">
          Groups
        </div>
        {groups.map((g) => (
          <Link
            key={g.id}
            href={`/app?group=${g.id}`}
            onClick={() => setMobileNav(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-[#00e676] transition hover:bg-[#00e676]/10"
          >
            <span className="text-lg">{groupEmoji(g.code)}</span>
            {g.name}
          </Link>
        ))}
      </nav>
      <div className="border-t border-[#134e32] p-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-[#134e32] bg-[#0a251b] p-2.5">
          <Avatar name={me.name} color={me.avatarColor} size={34} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold text-white">{me.name}</div>
            <div className="truncate text-[11px] text-[#7fbd97]">{me.country}</div>
          </div>
          <button
            onClick={logout}
            title="Log out"
            className="rounded-lg px-2 py-1 text-lg hover:bg-[#134e32]"
          >
            🚪
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-[#04120b]">
      <Toasts />
      {/* mobile top bar */}
      <div className="flex items-center gap-2 border-b border-[#134e32] bg-[#04120b] px-3 py-2.5 lg:hidden">
        <button
          onClick={() => setMobileNav(true)}
          className="grid h-9 w-9 place-items-center rounded-lg bg-[#0d2f22] text-lg text-neon"
          aria-label="Menu"
        >
          ☰
        </button>
        <Logo light compact />
        <Link href="/app/notifications" className="relative ml-auto grid h-9 w-9 place-items-center rounded-lg bg-[#0d2f22] text-lg">
          🔔
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
        </Link>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-[#134e32] bg-[#04120b] lg:block">
          {sidebar}
        </aside>

        {/* mobile drawer */}
        {mobileNav && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/70" onClick={() => setMobileNav(false)} />
            <aside className="anim-slide-in absolute bottom-0 left-0 top-0 w-72 border-r border-[#134e32] bg-[#04120b] shadow-2xl">
              {sidebar}
            </aside>
          </div>
        )}

        {/* content */}
        <main className="slim-scroll min-w-0 flex-1 overflow-y-auto bg-[#04120b] pb-24 lg:pb-6">
          {children}
        </main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-[#134e32] bg-[#04120b]/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur lg:hidden">
        {[
          { href: "/app", icon: "🏠", label: "Home", exact: true },
          { href: "/app/requests", icon: "📝", label: "Needs" },
          { href: "/app/offers", icon: "🏷️", label: "Sell" },
          { href: "/app/applications", icon: "📥", label: "Applies" },
          { href: "/app/deals", icon: "🤝", label: "Deals" },
          { href: "/app/profile", icon: "👤", label: "Profile" },
        ].map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              "flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-bold",
              isActive(n.href, n.exact) ? "text-neon" : "text-[#4d7a5f]"
            )}
          >
            <span className="text-xl">{n.icon}</span>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
