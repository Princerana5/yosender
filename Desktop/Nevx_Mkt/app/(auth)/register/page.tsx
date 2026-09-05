"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field, YellowButton, inputCls, toast, Toasts } from "@/components/ui";
import { COUNTRIES } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const [f, setF] = useState({
    name: "",
    email: "",
    country: "India",
    telegram: "",
    password: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      toast("Account created. Welcome to NEVX! 🎉");
      router.push("/app");
      router.refresh();
    } else {
      toast(j.error || "Registration failed.", false);
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
        <h1 className="mt-6 text-2xl font-black text-white">Create account ✨</h1>
        <p className="mt-1 text-sm text-[#7fbd97]">Join the needs & offers marketplace.</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <Field label="Full name">
            <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Your name" required />
          </Field>
          <Field label="Email">
            <input value={f.email} onChange={(e) => set("email", e.target.value)} className={inputCls} type="email" placeholder="you@email.com" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country">
              <select value={f.country} onChange={(e) => set("country", e.target.value)} className={inputCls}>
                {COUNTRIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Telegram (optional)">
              <input value={f.telegram} onChange={(e) => set("telegram", e.target.value)} className={inputCls} placeholder="@username" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Password">
              <input value={f.password} onChange={(e) => set("password", e.target.value)} className={inputCls} type="password" placeholder="Min 6 chars" required />
            </Field>
            <Field label="Confirm password">
              <input value={f.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} className={inputCls} type="password" placeholder="Repeat" required />
            </Field>
          </div>
          <YellowButton disabled={busy} className="w-full !py-3">
            {busy ? "Creating…" : "Get started free"}
          </YellowButton>
        </form>
        <p className="mt-4 text-center text-sm text-[#7fbd97]">
          Have an account?{" "}
          <Link href="/login" className="font-bold text-neon hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
