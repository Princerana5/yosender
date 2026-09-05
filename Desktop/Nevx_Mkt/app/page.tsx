import Link from "next/link";
import { CircleAction, SectionTitle } from "@/components/ui";

const STEPS = [
  { icon: "📝", title: "Post a Need", sub: "Describe what you need or what you sell." },
  { icon: "📥", title: "Sellers Apply", sub: "Providers apply through NEVX — no direct contact." },
  { icon: "🛡️", title: "NEVX Reviews", sub: "Admin verifies applications and picks the best fit." },
  { icon: "🤝", title: "Admin Mediates", sub: "Price, payment and delivery handled via admin." },
  { icon: "✅", title: "Deal Completed", sub: "Both sides confirm. Trust, guaranteed." },
];

const CHANNELS = [
  { icon: "💬", label: "Explore Services" },
  { icon: "🎧", label: "Talk to Sales" },
  { icon: "✈️", label: "Join Telegram" },
];

const GROUPS = ["🌍 World", "🇮🇳 India", "🇺🇸 USA", "🇨🇳 China", "🇩🇪 Germany"];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#04120b] text-[#eafff2]">
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-[#134e32] bg-[#04120b]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-neon text-lg font-black text-[#04120b] shadow-[0_0_18px_rgba(0,230,118,0.5)]">
              N
            </div>
            <div className="leading-tight">
              <div className="text-xl font-black tracking-tight text-white">
                NEV<span className="text-neon">X</span>
              </div>
              <div className="text-[10px] font-medium text-[#7fbd97]">Where Needs Meet Offers</div>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-bold text-[#b9e6c9] hover:bg-[#0d2f22] hover:text-white"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="anim-glow rounded-full bg-neon px-5 py-2 text-sm font-black text-[#04120b] transition hover:brightness-110"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO — like the reference: big neon headline, centered */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_0%,rgba(0,230,118,0.14),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-16 text-center sm:pt-20">
          <div className="anim-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#00e676]/30 bg-[#00e676]/10 px-4 py-1.5 text-xs font-bold text-neon">
              🛡️ 100% admin-mediated deals
            </div>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-[1.1] tracking-tight text-white sm:text-6xl">
              The World&apos;s Most Trusted{" "}
              <span className="text-neon drop-shadow-[0_0_18px_rgba(0,230,118,0.45)]">
                Needs & Offers
              </span>{" "}
              Marketplace.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[#7fbd97]">
              Needs • Offers • Services — all requests unified. Mediated deals
              for products & services in 197+ countries.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/register"
                className="anim-glow rounded-full bg-neon px-7 py-3 text-sm font-black text-[#04120b] transition hover:brightness-110 active:scale-[0.98]"
              >
                🙋 POST A NEED
              </Link>
              <Link
                href="/register"
                className="rounded-full border border-[#1d5c3a] bg-[#0d2f22] px-7 py-3 text-sm font-black text-white transition hover:border-[#00e676]/60 active:scale-[0.98]"
              >
                🏷️ SELL / OFFER
              </Link>
            </div>
            {/* circular actions like the reference */}
            <div className="mt-10 flex items-start justify-center gap-8 sm:gap-12">
              {CHANNELS.map((c) => (
                <CircleAction key={c.label} icon={c.icon} label={c.label} href="/app" />
              ))}
            </div>
          </div>

          {/* messenger preview card */}
          <div className="anim-pop mx-auto mt-12 max-w-2xl text-left">
            <div className="overflow-hidden rounded-3xl border border-[#134e32] bg-[#0a251b] shadow-[0_0_60px_rgba(0,230,118,0.12)]">
              <div className="flex items-center gap-2 border-b border-[#134e32] bg-[#061b12] px-4 py-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-[#00e676]/15 font-bold text-neon">🌍</div>
                <div>
                  <div className="text-sm font-extrabold text-white">WORLD</div>
                  <div className="text-[11px] text-[#7fbd97]">1,240 members online</div>
                </div>
                <div className="ml-auto flex gap-1.5 rounded-full bg-[#04120b] p-1 text-xs font-bold">
                  <span className="rounded-full bg-neon px-3 py-1 text-[#04120b]">NEEDS</span>
                  <span className="rounded-full px-3 py-1 text-[#7fbd97]">SELL</span>
                </div>
              </div>
              <div className="space-y-3 bg-[#061b12] p-4">
                {[
                  { n: "Sophia C.", t: "I need a website developer", b: "$200–$400", c: "#0e7490" },
                  { n: "Omar K.", t: "I need a used iPhone 15", b: "$500–$650", c: "#4f46e5" },
                  { n: "Anna M.", t: "I need a thumbnail designer", b: "$10–$15", c: "#ea580c" },
                ].map((x) => (
                  <div key={x.t} className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-3.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white"
                        style={{ background: x.c }}
                      >
                        {x.n[0]}
                      </div>
                      <div className="text-xs font-bold text-white">{x.n}</div>
                      <div className="ml-auto rounded-full bg-neon px-3 py-1 text-[11px] font-black text-[#04120b]">
                        APPLY
                      </div>
                    </div>
                    <div className="mt-1.5 text-sm font-bold text-white">{x.t}</div>
                    <div className="text-xs text-[#7fbd97]">Budget: {x.b}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-[#134e32] bg-[#061b12]">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <SectionTitle sub="Buyer → NEVX Admin → Seller. Nobody ever shares direct contact.">
            How NEVX Works
          </SectionTitle>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <div
                key={s.title}
                className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-5 text-center transition hover:border-[#00e676]/50"
              >
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#00e676]/10 text-2xl">
                  {s.icon}
                </div>
                <div className="mt-2 text-sm font-extrabold text-white">
                  {i + 1}. {s.title}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-[#7fbd97]">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GROUPS */}
      <section className="border-t border-[#134e32]">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <SectionTitle sub="Jump into a group and browse live needs & offers.">
            Popular Groups
          </SectionTitle>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {GROUPS.map((g) => (
              <Link
                key={g}
                href="/app?group=g_world"
                className="rounded-2xl border border-[#134e32] bg-[#0a251b] px-6 py-4 text-sm font-extrabold text-white transition hover:-translate-y-0.5 hover:border-[#00e676]/60 hover:shadow-[0_0_24px_rgba(0,230,118,0.15)]"
              >
                {g}
              </Link>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/app"
              className="anim-glow inline-block rounded-full bg-neon px-8 py-3.5 text-sm font-black text-[#04120b] transition hover:brightness-110"
            >
              Enter marketplace →
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#134e32] py-6 text-center text-xs text-[#4d7a5f]">
        NEVX — Where Needs Meet Offers · Buyer → Admin → Seller · No direct contact, ever.
      </footer>
    </div>
  );
}
