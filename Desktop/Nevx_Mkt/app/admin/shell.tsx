"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo, Toasts } from "@/components/ui";
import { cx } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "📊", exact: true },
  { href: "/admin/applications", label: "Applications", icon: "📥" },
  { href: "/admin/deals", label: "Deals", icon: "🤝" },
  { href: "/admin/requests", label: "Needs & Offers", icon: "📝" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/groups", label: "Groups", icon: "🌍" },
  { href: "/admin/categories", label: "Categories", icon: "🗂️" },
  { href: "/admin/reports", label: "Reports", icon: "🚩" },
];

export default function AdminShell({
  children,
  me,
  pendingApps,
  openReports,
  activeDeals,
}: {
  children: React.ReactNode;
  me: any;
  pendingApps: number;
  openReports: number;
  activeDeals: number;
}) {
  const path = usePathname();
  const router = useRouter();
  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || path.startsWith(href + "/");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-screen bg-[#04120b]">
      <Toasts />
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#134e32] bg-[#061b12] text-white md:flex">
        <div className="px-4 pb-3 pt-4">
          <Logo light />
          <div className="mt-1 inline-flex rounded-full border border-[#00e676]/40 bg-[#00e676]/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-neon">
            🛡️ {me.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
          </div>
        </div>
        <nav className="slim-scroll flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                isActive(n.href, n.exact)
                  ? "bg-neon font-bold text-[#04120b] shadow-[0_0_18px_rgba(0,230,118,0.35)]"
                  : "text-[#b9e6c9] hover:bg-[#0d2f22] hover:text-white"
              )}
            >
              <span className="text-lg">{n.icon}</span>
              {n.label}
              {n.label === "Applications" && pendingApps > 0 && (
                <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{pendingApps}</span>
              )}
              {n.label === "Deals" && activeDeals > 0 && (
                <span className="ml-auto rounded-full bg-[#0d2f22] px-2 py-0.5 text-[11px] font-bold text-neon ring-1 ring-[#00e676]/40">{activeDeals}</span>
              )}
              {n.label === "Reports" && openReports > 0 && (
                <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{openReports}</span>
              )}
            </Link>
          ))}
          <Link
            href="/app"
            className="mt-2 flex items-center gap-3 rounded-xl border border-[#1d5c3a] px-3 py-2.5 text-sm font-semibold text-[#b9e6c9] hover:bg-[#0d2f22]"
          >
            <span className="text-lg">🏠</span>
            View marketplace
          </Link>
        </nav>
        <div className="border-t border-[#134e32] p-3">
          <div className="flex items-center gap-2 text-sm">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-neon text-xs font-black text-[#04120b]">
              {me.name[0]}
            </div>
            <div className="min-w-0 flex-1 truncate text-xs font-bold text-white">{me.name}</div>
            <button onClick={logout} title="Log out" className="rounded-lg px-2 py-1 text-base hover:bg-[#134e32]">🚪</button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile topbar */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-[#134e32] bg-[#04120b] px-3 py-2.5 md:hidden">
          <Logo light compact />
          <div className="ml-2 flex gap-1.5">
            {NAV.slice(0, 6).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cx(
                  "whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-bold",
                  isActive(n.href, n.exact) ? "bg-neon text-[#04120b]" : "bg-[#0d2f22] text-[#7fbd97]"
                )}
              >
                {n.icon}
              </Link>
            ))}
          </div>
        </div>
        <main className="slim-scroll min-h-0 flex-1 overflow-y-auto bg-[#04120b] p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
