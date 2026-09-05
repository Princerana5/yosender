"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field, YellowButton, inputCls, toast, Toasts } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      toast("Welcome back to NEVX.");
      router.push(j.role && j.role !== "USER" ? "/admin" : "/app");
      router.refresh();
    } else {
      toast(j.error || "Login failed.", false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#04120b] px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_0%,rgba(0,230,118,0.16),transparent)]" />
      <Toasts />
      <div className="anim-pop relative w-full max-w-md rounded-3xl border border-[#134e32] bg-[#0a251b] p-7 shadow-[0_0_60px_rgba(0,230,118,0.12)] sm:p-8">
        <div className="flex items-center gap-2.5">
          <div className="anim-glow grid h-10 w-10 place-items-center rounded-full bg-neon text-xl font-black text-[#04120b]">N</div>
          <div>
            <div className="text-xl font-black text-white">NEV<span className="text-neon">X</span></div>
            <div className="text-[11px] text-[#7fbd97]">Where Needs Meet Offers</div>
          </div>
        </div>
        <h1 className="mt-6 text-2xl font-black text-white">Welcome back 👋</h1>
        <p className="mt-1 text-sm text-[#7fbd97]">Log in to your marketplace.</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <Field label="Email">
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} type="email" placeholder="you@email.com" required />
          </Field>
          <Field label="Password">
            <input value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} type="password" placeholder="••••••••" required />
          </Field>
          <YellowButton disabled={busy} className="w-full !py-3">
            {busy ? "Logging in…" : "Log in"}
          </YellowButton>
        </form>
        <div className="mt-4 rounded-xl border border-[#134e32] bg-[#061b12] p-3 text-xs leading-relaxed text-[#7fbd97]">
          <b className="text-white">Demo accounts:</b><br />
          👤 User: <b className="text-neon">priya@example.com</b> / password123<br />
          🛡️ Admin: <b className="text-neon">admin@nevx.io</b> / admin123
        </div>
        <p className="mt-4 text-center text-sm text-[#7fbd97]">
          No account?{" "}
          <Link href="/register" className="font-bold text-neon hover:underline">
            Get started free
          </Link>
        </p>
      </div>
    </div>
  );
}
