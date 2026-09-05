"use client";

import { useRouter } from "next/navigation";
import { GhostButton } from "@/components/ui";

export default function SettingsPage() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <h1 className="px-1 text-xl font-black text-white">⚙️ Settings</h1>
      <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-5">
        <div className="text-sm font-extrabold text-white">Trust & safety</div>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-[#b9e6c9]">
          <li>🔒 Buyer ↔ Admin ↔ Seller — no direct contact, ever.</li>
          <li>🛡️ Admin reviews every application before a deal is created.</li>
          <li>🚩 Report anything suspicious — admin responds fast.</li>
        </ul>
      </div>
      <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-5">
        <div className="text-sm font-extrabold text-white">Session</div>
        <GhostButton onClick={logout} className="mt-3 w-full">
          🚪 Log out
        </GhostButton>
      </div>
      <p className="text-center text-xs text-[#4d7a5f]">NEVX v1.0 · Where Needs Meet Offers</p>
    </div>
  );
}
