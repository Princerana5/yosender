"use client";
import { StoreProvider, useStore } from "@/lib/store";
import { Send, Shield, ShieldCheck, Zap, Users, BarChart3, Check, Menu, X, ArrowRight, Sparkles, Clock, Lock, Search, Pause, LogOut, Settings, LayoutDashboard, Megaphone, FileText, History, HelpCircle, Star, TrendingUp, Layers, Globe, ChevronRight, Play, Download, Mail, Trash2, KeyRound, Save, AtSign, Gem, Crown, Zap as ZapIcon, Diamond, BookOpen, Video, ExternalLink, GraduationCap, ListChecks, MessageCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { AdminPanel } from "./admin-panel";

function HoverTip({ tip, children, side = "top" }: { tip: string; children: React.ReactNode; side?: "top" | "bottom" }) {
  return (
    <span className="relative inline-flex group/tip cursor-help max-w-full">
      {children}
      <span
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 hidden group-hover/tip:block z-50 w-max max-w-[min(280px,calc(100vw-32px))] whitespace-normal break-words bg-[#229ED9] text-white text-[11px] leading-relaxed px-3 py-2 rounded-xl shadow-xl border border-white/10 text-center ${side === "top" ? "bottom-[calc(100%+10px)]" : "top-[calc(100%+10px)]"}`}
      >
        {tip}
        <span className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-[#229ED9] rotate-45 border-white/10 ${side === "top" ? "top-full -mt-1 border-r border-b" : "bottom-full -mb-1 border-l border-t"}`} />
      </span>
    </span>
  );
}

function featTip(feat: string): string {
  const m: Record<string, string> = {
    "10 groups / campaign": "You can only choose up to 10 groups in a single campaign",
    "100 groups / campaign": "You can only choose up to 100 groups in a single campaign",
    "1,000 groups / campaign": "You can only choose up to 1,000 groups in a single campaign",
    "10,000+ groups / campaign": "You can choose 10,000+ groups in a single campaign — unlimited scale",
    "10 campaigns / day": "You can only place 10 campaigns per day",
    "30 campaigns / day": "You can only place 30 campaigns per day",
    "Unlimited campaigns": "No daily limit — create as many campaigns as you want",
    "Unlimited everything": "No limits on groups, campaigns or repeats",
    "300 campaigns / month": "You can place up to 300 campaigns per month (10/day avg)",
    "900 campaigns / month": "You can place up to 900 campaigns per month (30/day avg)",
    "Repeat min 15 min": "Your message will be sent automatically to all selected groups every 15 minutes",
    "Repeat from 1 min": "Your message will be sent automatically to all selected groups every 1 minute",
    "Repeat min 1 min": "Your message will be sent automatically to all selected groups every 1 minute",
    "No repeat limit": "Your message will be sent automatically to all selected groups with no waiting time",
    "No free rented accounts": "No free rented accounts included — rent separately if needed",
    "1 rented account / day free": "1 rented sender account free every day — auto-added for 24h",
    "3 rented accounts / day free": "3 rented sender accounts free every day — auto-added for 24h",
    "10 rented accounts / day free": "10 rented sender accounts free every day — auto-added for 24h",
    "30 rented accounts / month free": "30 rented accounts free per month (1/day avg)",
    "90 rented accounts / month free": "90 rented accounts free per month (3/day avg)",
    "VIP 24/7 dedicated support": "VIP 24/7 dedicated support — priority help anytime",
    "Standard": "Standard support — help within 24 hours",
    "Priority": "Priority support — faster response, priority queue",
  };
  return m[feat] || feat;
}

function rowTip(feature: string, value: string): string {
  const f = feature.toLowerCase();
  if (f.includes("groups per campaign") || f.includes("groups / campaign")) {
    if (value.includes("10,000")) return "You can choose 10,000+ groups in a single campaign";
    if (value.includes("1,000")) return "You can only choose up to 1,000 groups in a single campaign";
    if (value.includes("100")) return "You can only choose up to 100 groups in a single campaign";
    if (value.includes("10")) return "You can only choose up to 10 groups in a single campaign";
  }
  if (f.includes("campaigns per day") || f.includes("campaigns / day")) {
    if (value.toLowerCase().includes("unlimited")) return "No daily limit — create as many campaigns as you want";
    if (value.includes("30")) return "You can only place 30 campaigns per day";
    if (value.includes("10")) return "You can only place 10 campaigns per day";
  }
  if (f.includes("repeat")) {
    if (value.includes("15")) return "Your message will be sent automatically to all selected groups every 15 minutes";
    if (value.includes("1 min")) return "Your message will be sent automatically to all selected groups every 1 minute";
    if (value.toLowerCase().includes("no limit")) return "Your message will be sent automatically to all selected groups with no waiting time";
  }
  if (f.includes("free rented")) {
    if (value === "0" || value === "—") return "No free rented accounts on this plan";
    if (value.includes("10")) return "10 rented sender accounts free every day";
    if (value.includes("3")) return "3 rented sender accounts free every day";
    if (value.includes("1")) return "1 rented sender account free every day";
  }
  if (f.includes("support")) {
    if (value.includes("VIP")) return "VIP 24/7 dedicated support — priority help anytime";
    if (value.includes("Priority")) return "Priority support — faster response";
    if (value.includes("Standard")) return "Standard support — help within 24 hours";
  }
  if (f.includes("price")) {
    if (value.includes("$2")) return "$2 per day — billed daily, 24h access";
    if (value.includes("$5")) return "$5 per day — billed daily, 24h access";
    if (value.includes("$12")) return "$12 per day — billed daily, 24h access";
    if (value.includes("$55")) return "$55 per month — 30 days access, save vs daily";
    if (value.includes("$150")) return "$150 per month — 30 days access, save vs daily";
    if (value.includes("$299")) return "$299 per month — 30 days access, save vs daily";
    if (value.includes("$1300")) return "$1300 per month — premium unlimited plan, monthly only";
    if (value === "—") return "Not available as daily — monthly only";
  }
  return `${feature}: ${value}`;
}

function GatewayModal({ open, plan, billing, price, paying, onClose, onCrypto }: { open: boolean; plan: any; billing: string; price: string; paying: boolean; onClose: () => void; onCrypto: () => void }) {
  if (!open || !plan) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-[24px] shadow-2xl w-full max-w-lg overflow-hidden animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold tracking-widest text-slate-400">CHECKOUT</div>
            <h3 className="text-lg font-extrabold tracking-tight text-slate-900 mt-1">Choose payment method</h3>
            <p className="text-xs text-slate-500 mt-1">Select a gateway to pay for <b>{plan.name}</b> — {billing === "daily" ? "Daily" : "Monthly"} · <b>{price}</b></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center hover:bg-slate-100 shrink-0"><X size={14} /></button>
        </div>
        <div className="p-6 space-y-3">
          {/* Crypto — primary gateway */}
          <button onClick={onCrypto} disabled={paying} className="w-full text-left bg-gradient-to-br from-[#EFF6FF] to-white border-2 border-[#229ED9] rounded-2xl p-4 hover:shadow-lg hover:shadow-[#229ED9]/10 hover:-translate-y-0.5 transition-all disabled:opacity-50 group">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#229ED9] flex items-center justify-center text-white font-bold text-sm shrink-0">₿</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-2">Pay with Crypto <span className="text-[10px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">RECOMMENDED</span></div>
                <div className="text-xs text-slate-500 mt-0.5">BTC · ETH · USDT · TON · SOL · ADA · 300+ coins via NOWPayments</div>
              </div>
              <ChevronRight size={16} className="text-[#229ED9] group-hover:translate-x-0.5 transition-transform shrink-0" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-bold bg-[#229ED9] text-white px-3 py-1.5 rounded-full">{paying ? "Creating invoice…" : `Pay ${price} with Crypto →`}</span>
              <span className="text-[11px] text-slate-400">Redirects to NOWPayments invoice</span>
            </div>
          </button>
          {/* Future gateways — disabled */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 opacity-60">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><CreditCardIcon /> Card</div>
              <div className="text-[11px] text-slate-400 mt-1">Stripe / Razorpay</div>
              <span className="mt-2 inline-flex text-[10px] font-bold tracking-widest bg-white border border-slate-200 px-2 py-1 rounded-full text-slate-500">COMING SOON</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 opacity-60">
              <div className="text-xs font-bold text-slate-700">UPI / Bank</div>
              <div className="text-[11px] text-slate-400 mt-1">India local</div>
              <span className="mt-2 inline-flex text-[10px] font-bold tracking-widest bg-white border border-slate-200 px-2 py-1 rounded-full text-slate-500">COMING SOON</span>
            </div>
          </div>
          <p className="text-[11px] text-center text-slate-400 leading-relaxed">After crypto payment is confirmed, your <b>API key (license key)</b> is auto-generated and your plan is <b>auto-activated</b> — no manual redeem needed. You’ll see it here and in Plans.</p>
        </div>
      </div>
    </div>
  );
}
function CreditCardIcon() { return <span className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[10px]">💳</span>; }

function ConnectedCard({ tg, onLogout }: { tg: any, onLogout: () => void }) {
  const [photo, setPhoto] = useState<string | null>(tg.photo || null);
  const displayName = tg.displayName || tg.firstName || tg.username || tg.phone || "Telegram User";
  const handle = tg.username ? `@${tg.username}` : tg.phone || "";
  useEffect(() => {
    if (tg.photo) { setPhoto(tg.photo); return; }
    fetch("/api/telegram/photo").then(r => r.json()).then(j => { if (j.photo) setPhoto(j.photo); }).catch(() => {});
  }, [tg?.phone, tg?.username]);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="p-3.5 flex items-center gap-3">
        {photo ? <img src={photo} alt={displayName} className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0" /> : <div className="w-10 h-10 rounded-full bg-[#229ED9] flex items-center justify-center text-white font-semibold text-sm shrink-0">{(displayName?.[0] || "?").toUpperCase()}</div>}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight truncate text-slate-900">{displayName}</div>
          <div className="text-xs text-slate-500 truncate flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" />{handle}</div>
        </div>
        <span className="shrink-0 text-[10px] font-bold tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-full">ACTIVE</span>
      </div>
      <div className="px-2 pb-2 flex gap-2">
        <button onClick={onLogout} className="flex-1 bg-[#229ED9] text-white px-3 py-2 rounded-full text-xs font-semibold hover:bg-[#1B8AC4] transition flex items-center justify-center gap-1.5"><LogOut size={12} /> Logout</button>
        <button onClick={onLogout} className="flex-1 bg-white border border-slate-200 px-3 py-2 rounded-full text-xs font-semibold hover:bg-slate-50 transition">Home</button>
      </div>
    </div>
  );
}

function TelegramAccountsCard({ onConnect }: { onConnect: () => void }) {
  const { tgAccounts, activeTgId, setActiveTgId, refreshTgAccounts, setTg, refreshDests } = useStore() as any;
  const [switching, setSwitching] = useState<string | null>(null);
  const max = 10;
  const switchTo = async (id: string) => {
    setSwitching(id);
    try {
      const r = await fetch("/api/telegram/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: id }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setActiveTgId(id);
      const acc = tgAccounts.find((a: any) => a.id === id);
      if (acc) setTg({ username: acc.username, phone: acc.phone, connected: true, displayName: acc.displayName, firstName: acc.firstName });
      await refreshTgAccounts();
      try { await refreshDests(); } catch {}
    } catch (e: any) { alert(e.message); } finally { setSwitching(null); }
  };
  const remove = async (id: string) => {
    if (!confirm("Remove this Telegram account? You can reconnect it anytime.")) return;
    try {
      const r = await fetch(`/api/telegram/accounts?id=${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await refreshTgAccounts();
      if (activeTgId === id) { try { await refreshDests(); } catch {} }
    } catch (e: any) { alert(e.message); }
  };
  if (!tgAccounts?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mt-3">
      <div className="px-3.5 pt-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#229ED9] flex items-center justify-center"><Users size={12} className="text-white" /></div>
          <span className="text-[12px] font-semibold tracking-tight text-slate-900">Accounts</span>
          <span className="text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">{tgAccounts.length}/{max}</span>
        </div>
      </div>
      <p className="px-3.5 pt-1.5 text-[11px] leading-relaxed text-slate-500">Active account is used for all campaigns.</p>
      <div className="p-2 space-y-1 mt-2">
        {tgAccounts.map((a: any) => {
          const active = a.id === activeTgId;
          const initial = (a.displayName || a.username || a.phone || "?")[0].toUpperCase();
          return (
            <div key={a.id} className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 border transition ${active ? "bg-[#229ED9] border-slate-900 shadow-sm" : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${active ? "bg-white text-slate-900" : "bg-slate-50 text-slate-700 border border-slate-200"}`}>{initial}</div>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-semibold leading-none truncate ${active ? "text-white" : "text-slate-900"}`}>{a.displayName || a.username || a.phone}</div>
                <div className={`text-[11px] truncate mt-1 ${active ? "text-white/60" : "text-slate-500"}`}>{a.username ? `@${a.username}` : a.phone}<span className="mx-1 opacity-40">·</span>{a.phone}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {active ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-widest bg-white text-slate-900 px-2 py-1 rounded-full"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />ACTIVE</span>
                ) : (
                  <button onClick={() => switchTo(a.id)} disabled={!!switching} className="text-xs font-semibold bg-[#229ED9] text-white px-3 py-1.5 rounded-full hover:bg-[#1B8AC4] disabled:opacity-50 transition">{switching === a.id ? "…" : "Switch"}</button>
                )}
                <button onClick={() => remove(a.id)} aria-label="Remove account" className={`w-7 h-7 rounded-full flex items-center justify-center transition ${active ? "text-white/60 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-red-600 hover:bg-red-50"}`}><X size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-2 border-t border-slate-100 bg-slate-50/60">
        {tgAccounts.length < max ? (
          <button onClick={onConnect} className="w-full bg-white border border-slate-200 text-slate-900 rounded-full py-2.5 text-xs font-semibold hover:bg-[#229ED9] hover:text-white hover:border-slate-900 transition flex items-center justify-center gap-1.5"><span className="text-sm leading-none">+</span> Add Telegram account</button>
        ) : (
          <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-center">Limit reached — {max} accounts max.</div>
        )}
      </div>
    </div>
  );
}

function LiveHeroCard() {
  const { campaigns } = useStore();
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await fetch("/api/stats"); const j = await r.json(); if (alive) setStats(j); } catch {}
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [campaigns.length]);
  const totalCampaigns = stats ? stats.totalCampaigns : campaigns.length;
  const totalSent = stats ? stats.totalSent : campaigns.reduce((a: number, c: any) => a + (c.successful || 0), 0);
  const totalDests = stats ? stats.totalDestinations : campaigns.reduce((a: number, c: any) => a + (c.destinations?.length || 0), 0);
  const uniqueGroups = stats ? (stats.uniqueGroups ?? totalDests) : new Set(campaigns.flatMap((c: any) => c.destinations || [])).size;
  const running = stats ? stats.running : campaigns.filter((c: any) => c.status === "Running" || c.status === "Repeating").length;
  const pct = totalDests ? Math.round((totalSent / totalDests) * 100) : 0;
  const isLive = running > 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 relative min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-600">Platform stats — live</span>
        </div>
        <span className={`text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full border ${isLive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>{isLive ? "● LIVE" : "LIVE STATS"}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 text-center">
          <div className="text-[10px] font-bold tracking-widest text-slate-500">CAMPAIGNS</div>
          <div className="text-xl sm:text-2xl font-bold mt-1 tracking-tight text-slate-900">{totalCampaigns.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400 mt-1">Total pushed</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 text-center">
          <div className="text-[10px] font-bold tracking-widest text-slate-500">MESSAGES</div>
          <div className="text-xl sm:text-2xl font-bold mt-1 tracking-tight text-slate-900">{totalSent.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400 mt-1">Total sent</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 text-center">
          <div className="text-[10px] font-bold tracking-widest text-slate-500">GROUPS</div>
          <div className="text-xl sm:text-2xl font-bold mt-1 tracking-tight text-slate-900">{Number(uniqueGroups).toLocaleString()}</div>
          <div className="text-[11px] text-slate-400 mt-1">Targeted</div>
        </div>
      </div>
      <div className="mt-4 h-1.5 bg-slate-50 rounded-full overflow-hidden"><div className="h-1.5 bg-[#229ED9] rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="flex justify-between text-[11px] text-slate-400 mt-2"><span>{pct}% delivered</span><span>{running ? `${running} running` : totalCampaigns ? "all time" : "be the first to send"}</span></div>
    </div>
  );
}

function PricingSection({ onNav }: { onNav: (v: string) => void }) {
  const { user, setView } = useStore() as any;
  const [billing, setBilling] = useState<"daily" | "monthly">("monthly");
  const [cryptoPaying, setCryptoPaying] = useState<string | null>(null);
  const [gatewayPlan, setGatewayPlan] = useState<any>(null);
  const isMonthly = billing === "monthly";
  const handleBuy = (planId: string) => {
    if (!user) { onNav("signup"); return; }
    const p = [{ id: "elite", name: "Elite", daily: "$2", monthly: "$55" }, { id: "pro", name: "Pro", daily: "$5", monthly: "$150" }, { id: "max_plus", name: "Max+", daily: "$12", monthly: "$299" }, { id: "luxe", name: "Luxe", daily: null, monthly: "$1300" }].find(x=>x.id===planId);
    setGatewayPlan(p ? { ...p, billing: p.id==="luxe" ? "monthly" : billing } : { id: planId, billing });
  };
  const handleCrypto = async () => {
    if (!gatewayPlan) return;
    const planId = gatewayPlan.id;
    const b = gatewayPlan.billing;
    const k = `${planId}:${b}`;
    // Open blank window synchronously inside user gesture — otherwise popup blocker kills it after await
    const win = window.open("about:blank", "_blank");
    if (win) win.document.write('<p style="font-family:sans-serif;text-align:center;margin-top:40px">Creating invoice… please wait</p>');
    setCryptoPaying(k);
    try {
      const r = await fetch("/api/payments/crypto/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, billing: b }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setGatewayPlan(null);
      if (win && !win.closed) win.location.href = j.invoiceUrl;
      else window.location.href = j.invoiceUrl;
    } catch (e: any) {
      if (win && !win.closed) win.close();
      alert(e.message);
    } finally { setCryptoPaying(null); }
  };
  const plans = [
    { id: "elite", name: "Elite", daily: "$2", monthly: "$55", per: isMonthly ? "/mo" : "/day", price: isMonthly ? "$55" : "$2", feats: ["10 groups / campaign", isMonthly ? "300 campaigns / month" : "10 campaigns / day", "Repeat min 15 min", "No free rented accounts"], cta: "Buy Now", icon: Gem, iconBg: "bg-slate-50", iconColor: "text-slate-600" },
    { id: "pro", name: "Pro", daily: "$5", monthly: "$150", per: isMonthly ? "/mo" : "/day", price: isMonthly ? "$150" : "$5", feats: ["100 groups / campaign", isMonthly ? "900 campaigns / month" : "30 campaigns / day", "Repeat from 1 min", isMonthly ? "30 rented accounts / month free" : "1 rented account / day free"], cta: "Buy Now", icon: ZapIcon, iconBg: "bg-slate-50", iconColor: "text-slate-600" },
    { id: "max_plus", name: "Max+", daily: "$12", monthly: "$299", per: isMonthly ? "/mo" : "/day", price: isMonthly ? "$299" : "$12", feats: ["1,000 groups / campaign", "Unlimited campaigns", "No repeat limit", isMonthly ? "90 rented accounts / month free" : "3 rented accounts / day free"], popular: true, cta: "Buy Now", icon: Diamond, iconBg: "bg-[#229ED9]", iconColor: "text-white" },
    { id: "luxe", name: "Luxe", daily: null, monthly: "$1300", per: "/mo", price: "$1300", feats: ["10,000+ groups / campaign", "Unlimited everything", "10 rented accounts / day free", "VIP 24/7 dedicated support"], vip: true, cta: "Buy Now", icon: Crown, iconBg: "bg-amber-50", iconColor: "text-amber-600" },
  ];
  return (
    <>
      <div className="flex justify-center mt-6">
        <div className="bg-slate-50 border border-slate-200 rounded-full p-1 flex gap-1">
          <button onClick={() => setBilling("daily")} className={`px-5 py-2 rounded-full text-sm font-semibold transition ${billing === "daily" ? "bg-[#229ED9] text-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>Daily</button>
          <button onClick={() => setBilling("monthly")} className={`px-5 py-2 rounded-full text-sm font-semibold transition ${billing === "monthly" ? "bg-[#229ED9] text-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>Monthly <span className="text-[10px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full ml-1">SAVE</span></button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        {plans.map((p: any) => {
          const Icon = p.icon;
          const isLuxe = p.id === "luxe";
          return (
          <div key={p.id} className={`bg-white border rounded-2xl p-5 flex flex-col relative ${p.popular ? "border-slate-900 shadow-lg" : p.vip ? "border-amber-200" : "border-slate-200"}`}>
            {p.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#229ED9] text-white text-[10px] font-bold tracking-widest px-3 py-1 rounded-full whitespace-nowrap">MOST POPULAR</div>}
            {p.vip && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[10px] font-bold tracking-widest px-3 py-1 rounded-full flex items-center gap-1 whitespace-nowrap"><Crown size={10} /> VIP</div>}
            <div className={`w-9 h-9 rounded-lg border flex items-center justify-center mt-2 ${p.popular ? "bg-[#229ED9] border-slate-900" : "bg-white border-slate-200"}`}><Icon size={16} className={p.iconColor} /></div>
            <h3 className="font-bold text-base mt-3 flex items-center gap-2 text-slate-900">{p.name} {p.vip && <Sparkles size={12} className="text-amber-500" />}</h3>
            <div className="text-2xl font-bold mt-1 tracking-tight text-slate-900">{p.price}<span className="text-sm font-medium text-slate-400">{p.per}</span></div>
            <div className="text-xs text-slate-400 mt-1">{isLuxe ? "Monthly only" : isMonthly ? `or ${p.daily}/day` : `or ${p.monthly}/mo`}</div>
            <ul className="mt-4 space-y-2 text-sm flex-1">{p.feats.map((f: string) => <li key={f} className="flex gap-2 text-slate-600"><Check size={14} className="text-emerald-600 shrink-0 mt-0.5" /><HoverTip tip={featTip(f)}><span className="border-b border-dotted border-slate-300">{f}</span></HoverTip></li>)}</ul>
            <button onClick={() => handleBuy(p.id)} className={`w-full mt-5 py-2.5 rounded-full text-sm font-semibold transition flex items-center justify-center gap-1.5 ${p.popular ? "bg-[#229ED9] text-white hover:bg-[#1B8AC4] shadow-md" : p.vip ? "bg-amber-500 text-white hover:bg-amber-600 shadow-md" : "bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 hover:border-slate-300"}`}>{p.cta}</button>
            <div className="text-[10px] text-center text-slate-400 mt-1">BTC · ETH · USDT · 300+ coins via NOWPayments</div>
          </div>
        );})}
      </div>
      <p className="text-center text-xs text-slate-400 mt-4">Click <b>Buy Now</b> → choose gateway → <b>Pay with Crypto</b> → auto-generates <b>API key</b> & auto-activates plan. 300+ coins via NOWPayments.</p>
      <GatewayModal open={!!gatewayPlan} plan={gatewayPlan} billing={gatewayPlan?.billing || billing} price={gatewayPlan ? (gatewayPlan.id==="luxe" ? gatewayPlan.monthly : gatewayPlan.billing==="monthly" ? gatewayPlan.monthly : gatewayPlan.daily) : ""} paying={!!cryptoPaying} onClose={() => setGatewayPlan(null)} onCrypto={handleCrypto} />
    </>
  );
}

function ComparisonTable() {
  const rows: Array<[string, string, string, string, string]> = [
    ["Price (daily)", "$2 / day", "$5 / day", "$12 / day", "$1300 / mo only"],
    ["Price (monthly)", "$55 / mo", "$150 / mo", "$299 / mo", "$1300 / mo"],
    ["Groups per campaign", "10", "100", "1,000", "10,000+"],
    ["Campaigns per day", "10", "30", "Unlimited", "Unlimited"],
    ["Repeat min interval", "15 min", "1 min", "No limit", "No limit"],
    ["Free rented / day", "0", "1", "3", "10"],
    ["Support", "Standard", "Priority", "Priority", "VIP 24/7 dedicated"],
  ];
  return (
    <div className="mt-8 bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-slate-200 flex items-center gap-2"><span className="font-semibold text-sm text-slate-900">Compare all plans</span><span className="text-xs text-slate-400 hidden sm:inline">— daily or monthly</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 md:px-5 py-3">FEATURE</th><th className="px-3 py-3 text-center">ELITE</th><th className="px-3 py-3 text-center">PRO</th><th className="px-3 py-3 text-center">MAX+</th><th className="px-3 py-3 text-center">LUXE</th></tr></thead>
          <tbody>{rows.map(([feat, a, b, c, d]) => <tr key={feat} className="border-t border-slate-100"><td className="px-4 md:px-5 py-3 font-medium text-sm text-slate-700">{feat}</td><td className="px-3 py-3 text-center text-sm text-slate-600"><HoverTip tip={rowTip(feat, a)}><span className="border-b border-dotted border-slate-300">{a}</span></HoverTip></td><td className="px-3 py-3 text-center text-sm font-medium text-slate-900 bg-slate-50/50"><HoverTip tip={rowTip(feat, b)}><span className="border-b border-dotted border-slate-300">{b}</span></HoverTip></td><td className="px-3 py-3 text-center text-sm text-slate-600"><HoverTip tip={rowTip(feat, c)}><span className="border-b border-dotted border-slate-300">{c}</span></HoverTip></td><td className="px-3 py-3 text-center text-sm font-semibold text-amber-700 bg-amber-50/30"><HoverTip tip={rowTip(feat, d)}><span className="border-b border-dotted border-amber-300">{d}</span></HoverTip></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Landing({ onNav }: { onNav: (v: string) => void }) {
  const [mobile, setMobile] = useState(false);
  const { user } = useStore() as any;
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Header — glassmorphism */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 font-bold text-[17px] tracking-tight shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#229ED9] to-[#1B8AC4] flex items-center justify-center text-white shadow-md shadow-[#229ED9]/20"><Send size={15} /></div>
            Subplus
            <span className="hidden sm:inline-flex text-[10px] font-bold tracking-widest bg-[#EFF6FF] text-[#229ED9] border border-[#BFDBFE] px-2 py-0.5 rounded-full">PRO</span>
          </div>
          <nav className="hidden md:flex items-center gap-1 text-[13px] font-medium text-slate-500">
            <a href="#features" className="px-3 py-2 rounded-full hover:bg-slate-50 hover:text-slate-900 transition">Features</a>
            <a href="#how" className="px-3 py-2 rounded-full hover:bg-slate-50 hover:text-slate-900 transition">How it works</a>
            <a href="#pricing" className="px-3 py-2 rounded-full hover:bg-slate-50 hover:text-slate-900 transition">Pricing</a>
            <a href="#faq" className="px-3 py-2 rounded-full hover:bg-slate-50 hover:text-slate-900 transition">FAQ</a>
          </nav>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {user ? (
              <button onClick={() => onNav("dashboard")} className="bg-[#229ED9] text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-[#1B8AC4] hover:shadow-lg hover:shadow-[#229ED9]/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center gap-1.5"><LayoutDashboard size={14} /> Dashboard</button>
            ) : (
              <>
                <button onClick={() => onNav("login")} className="text-sm font-medium px-4 py-2 rounded-full hover:bg-slate-50 transition">Login</button>
                <button onClick={() => onNav("signup")} className="bg-[#229ED9] text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-[#1B8AC4] hover:shadow-lg hover:shadow-[#229ED9]/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all">Get Started →</button>
              </>
            )}
          </div>
          <button className="md:hidden w-9 h-9 rounded-xl bg-[#229ED9] text-white flex items-center justify-center shrink-0 hover:bg-[#1B8AC4] active:scale-95 transition-all" onClick={() => setMobile(!mobile)} aria-label="Menu">{mobile ? <X size={16} /> : <Menu size={16} />}</button>
        </div>
        {mobile && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-3 animate-slide-down">
            <nav className="flex flex-col gap-1 text-sm">
              <a href="#features" onClick={() => setMobile(false)} className="py-2.5 px-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50">Features</a>
              <a href="#how" onClick={() => setMobile(false)} className="py-2.5 px-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50">How it works</a>
              <a href="#pricing" onClick={() => setMobile(false)} className="py-2.5 px-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50">Pricing</a>
              <a href="#faq" onClick={() => setMobile(false)} className="py-2.5 px-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50">FAQ</a>
            </nav>
            <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
              {user ? (
                <button onClick={() => { setMobile(false); onNav("dashboard"); }} className="bg-[#229ED9] text-white rounded-full py-3 font-semibold flex items-center justify-center gap-2"><LayoutDashboard size={16} /> Dashboard</button>
              ) : (
                <>
                  <button onClick={() => { setMobile(false); onNav("login"); }} className="border border-slate-200 rounded-full py-3 font-semibold hover:bg-slate-50 transition">Login</button>
                  <button onClick={() => { setMobile(false); onNav("signup"); }} className="bg-[#229ED9] text-white rounded-full py-3 font-semibold hover:bg-[#1B8AC4] transition">Get Started</button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Hero — spacious, premium */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#EFF6FF] via-white to-[#F0F9FF] pointer-events-none" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-br from-[#229ED9]/8 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-violet-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-10 md:py-20 grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 items-center relative">
          <div className="min-w-0 animate-slide-up">
            <div className="inline-flex items-center gap-2 text-xs font-semibold bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-slate-600 shadow-sm">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              Trusted by 12,000+ community managers
              <span className="hidden sm:inline-flex items-center gap-1 ml-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">● LIVE</span>
            </div>
            <h1 className="text-[30px] sm:text-[38px] lg:text-[48px] font-extrabold leading-[1.02] tracking-tight mt-6">
              Manage Telegram<br />
              <span className="bg-gradient-to-r from-[#229ED9] to-[#1B8AC4] bg-clip-text text-transparent">group messaging</span><br />
              <span className="text-slate-400 font-bold">from one dashboard.</span>
            </h1>
            <p className="text-slate-500 mt-4 text-[14px] md:text-[15px] leading-7 max-w-xl">Connect your Telegram account, organize eligible destinations, create your message once, and manage authorized group communications from a single premium workspace.</p>
            <div className="flex flex-col sm:flex-row gap-3 mt-7">
              <button onClick={() => onNav("signup")} className="group bg-[#229ED9] text-white px-7 py-3.5 rounded-full font-semibold flex items-center justify-center gap-2 hover:bg-[#1B8AC4] hover:shadow-xl hover:shadow-[#229ED9]/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all">
                Connect Telegram <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })} className="group bg-white border border-slate-200 px-7 py-3.5 rounded-full font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 hover:border-slate-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all shadow-sm">
                <span className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center group-hover:bg-[#229ED9] transition-colors"><Play size={12} className="ml-0.5" /></span> How it works
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-4 md:gap-6 mt-6">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center"><Shield size={11} className="text-emerald-600" /></span> Rate-limit safe</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className="w-6 h-6 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center"><Lock size={11} className="text-blue-600" /></span> Encrypted</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className="w-6 h-6 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center"><Star size={11} className="text-amber-500" /></span> 4.9/5 · 2k reviews</span>
            </div>
          </div>
          <div className="animate-slide-up stagger-2">
            <LiveHeroCard />
          </div>
        </div>
      </section>

      {/* Social proof */}
      <div className="border-y border-slate-200 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">
          <p className="text-center text-[11px] font-bold tracking-widest text-slate-400 mb-3">TRUSTED BY TEAMS AT</p>
          <div className="flex flex-wrap justify-center items-center gap-6 md:gap-10 text-xs font-bold tracking-widest text-slate-300">
            <span className="hover:text-slate-500 transition-colors cursor-default">LINEAR</span>
            <span className="hover:text-slate-500 transition-colors cursor-default">VERCEL</span>
            <span className="hover:text-slate-500 transition-colors cursor-default">STRIPE</span>
            <span className="hover:text-slate-500 transition-colors cursor-default">NOTION</span>
            <span className="hover:text-slate-500 transition-colors cursor-default">INTERCOM</span>
            <span className="hover:text-slate-500 transition-colors cursor-default">FIGMA</span>
          </div>
        </div>
      </div>

      {/* Features — staggered cards with hover lift */}
      <section id="features" className="max-w-7xl mx-auto px-4 md:px-6 py-14 md:py-20">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="inline-flex text-[11px] font-bold tracking-widest bg-[#EFF6FF] text-[#229ED9] border border-[#BFDBFE] px-3 py-1 rounded-full">FEATURES</span>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mt-3">Everything you need to scale</h2>
          <p className="text-sm text-slate-500 mt-2 leading-6">Professional tools for Telegram community management — safe, fast, and fully tracked.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {[
            { icon: Shield, title: "Permission-aware", desc: "Only destinations where you can post are shown. No bypasses, no spam.", color: "emerald" },
            { icon: Zap, title: "Rate-limit safe", desc: "Conservative queue with flood-wait handling and auto-pause.", color: "amber" },
            { icon: BarChart3, title: "Delivery tracking", desc: "Per-destination logs with success, failed and rate-limited states.", color: "blue" },
            { icon: Lock, title: "Encrypted sessions", desc: "Telegram sessions encrypted at rest, never exposed to browser.", color: "violet" },
            { icon: Globe, title: "Multi-destination", desc: "Select many eligible groups & channels and send once.", color: "sky" },
            { icon: Layers, title: "Campaign control", desc: "Pause, cancel and resume with full history & analytics.", color: "slate" },
          ].map((f, i) => (
            <div key={f.title} className={`group bg-white border border-slate-200 rounded-2xl p-6 hover:border-[#BFDBFE] hover:shadow-lg hover:shadow-[#229ED9]/5 hover:-translate-y-1 transition-all duration-300 animate-slide-up stagger-${(i % 3) + 1}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${
                f.color === "emerald" ? "bg-emerald-50 border border-emerald-200 group-hover:bg-emerald-500" :
                f.color === "amber" ? "bg-amber-50 border border-amber-200 group-hover:bg-amber-500" :
                f.color === "blue" ? "bg-blue-50 border border-blue-200 group-hover:bg-[#229ED9]" :
                f.color === "violet" ? "bg-violet-50 border border-violet-200 group-hover:bg-violet-500" :
                f.color === "sky" ? "bg-sky-50 border border-sky-200 group-hover:bg-sky-500" :
                "bg-slate-50 border border-slate-200 group-hover:bg-slate-900"
              }`}>
                <f.icon size={16} className={`transition-colors duration-300 ${
                  f.color === "emerald" ? "text-emerald-600 group-hover:text-white" :
                  f.color === "amber" ? "text-amber-600 group-hover:text-white" :
                  f.color === "blue" ? "text-[#229ED9] group-hover:text-white" :
                  f.color === "violet" ? "text-violet-600 group-hover:text-white" :
                  f.color === "sky" ? "text-sky-600 group-hover:text-white" :
                  "text-slate-600 group-hover:text-white"
                }`} />
              </div>
              <h3 className="font-semibold text-sm mt-4 text-slate-900">{f.title}</h3>
              <p className="text-sm text-slate-500 mt-1.5 leading-5">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — gradient with glass cards */}
      <section id="how" className="relative overflow-hidden bg-gradient-to-br from-[#229ED9] via-[#1B8AC4] to-[#0F6FA8] text-white py-14 md:py-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.1),_transparent_60%)] pointer-events-none" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 md:px-6 relative">
          <div className="text-center">
            <span className="inline-flex text-[11px] font-bold tracking-widest bg-white/15 border border-white/20 px-3 py-1 rounded-full backdrop-blur">HOW IT WORKS</span>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mt-3">From connect to delivered in 4 steps</h2>
            <p className="text-white/60 mt-2 text-sm">Simple, fast, and fully guided — no learning curve.</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mt-10">
            {[
              { n: "01", t: "Connect Telegram", d: "Phone → OTP → 2FA" },
              { n: "02", t: "Select Destinations", d: "Pick eligible groups" },
              { n: "03", t: "Create Message", d: "Text + image + preview" },
              { n: "04", t: "Send & Track", d: "Live progress & logs" },
            ].map((s, i) => (
              <div key={s.t} className={`group bg-white/10 backdrop-blur border border-white/15 rounded-2xl p-5 md:p-6 text-center hover:bg-white/15 hover:border-white/25 hover:-translate-y-1 transition-all duration-300 animate-slide-up stagger-${i + 1}`}>
                <div className="w-10 h-10 rounded-xl bg-white text-[#229ED9] flex items-center justify-center mx-auto text-sm font-extrabold shadow-lg group-hover:scale-110 transition-transform duration-300">{s.n}</div>
                <div className="font-semibold text-sm mt-4">{s.t}</div>
                <div className="text-xs text-white/50 mt-1">{s.d}</div>
                <div className="text-[10px] font-bold tracking-widest text-white/30 mt-2">STEP {i + 1} OF 4</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="max-w-7xl mx-auto px-4 md:px-6 py-14 md:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="inline-flex text-[11px] font-bold tracking-widest bg-[#EFF6FF] text-[#229ED9] border border-[#BFDBFE] px-3 py-1 rounded-full">PRICING</span>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mt-3">Choose your plan — key activated</h2>
          <p className="text-sm text-slate-500 mt-2">Pay → get a license key → redeem in Plans. Daily or monthly. No hidden fees.</p>
        </div>
        <PricingSection onNav={onNav} />
        <ComparisonTable />
      </section>

      <section id="faq" className="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-14">
        <div className="text-center mb-8">
          <span className="inline-flex text-[11px] font-bold tracking-widest bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1 rounded-full">FAQ</span>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 mt-3">Questions? We have answers.</h2>
        </div>
        <div className="space-y-3">
          {[
            ["Does this bypass Telegram limits?", "No. It respects flood-wait, rate limits and only posts where you have permission. Your account stays safe."],
            ["Is my session secure?", "Sessions are encrypted at rest and never sent to the browser. Only you can access your Telegram."],
            ["Can I pause a campaign?", "Yes — pause, cancel or resume anytime. Rate-limit events auto-pause to protect your account."],
          ].map(([q, a]) => (
            <div key={q} className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-[#BFDBFE] hover:shadow-md transition-all">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-[#229ED9] group-hover:border-[#229ED9] transition-colors"><HelpCircle size={13} className="text-[#229ED9] group-hover:text-white transition-colors" /></span>
                <div>
                  <div className="font-semibold text-sm text-slate-900">{q}</div>
                  <div className="text-sm text-slate-500 mt-1 leading-6">{a}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#229ED9] flex items-center justify-center text-white"><Send size={14} /></div>
              <span className="font-bold text-sm">Subplus</span>
              <span className="text-xs text-slate-400 hidden sm:inline">— Professional Telegram communication management</span>
            </div>
            <div className="flex items-center gap-6 text-xs font-medium text-slate-500">
              <a href="#features" className="hover:text-slate-900 transition">Features</a>
              <a href="#pricing" className="hover:text-slate-900 transition">Pricing</a>
              <a href="#faq" className="hover:text-slate-900 transition">FAQ</a>
              <span className="text-slate-300">© 2026</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Auth({ mode, onNav }: { mode: "login" | "signup", onNav: (v: string) => void }) {
  const { setUser } = useStore();
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [pass, setPass] = useState(""), [tgUser, setTgUser] = useState("");
  const [loading, setLoading] = useState(false), [err, setErr] = useState("");
  const submit = async () => {
    if (!email || !pass || (mode === "signup" && !name)) { setErr("Fill all fields"); return; }
    setErr(""); setLoading(true);
    try {
      const url = mode === "signup" ? "/api/auth/register" : "/api/auth/login";
      const body: any = mode === "signup" ? { name, email, password: pass, telegramUsername: tgUser } : { email, password: pass };
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setUser(j.user); onNav("connect");
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-[#229ED9]/10 to-transparent rounded-full blur-3xl" />
      <div className="bg-white border border-[#E2E8F0] rounded-[24px] p-8 w-full max-w-md shadow-2xl shadow-black/10 relative">
        <div className="flex items-center gap-2.5 font-bold text-lg"><div className="w-9 h-9 rounded-xl bg-[#229ED9] flex items-center justify-center text-white shadow"><Send size={16} /></div>Subplus</div>
        <h2 className="text-2xl font-extrabold tracking-tight mt-5">{mode === "signup" ? "Create account" : "Welcome back"}</h2>
        <p className="text-sm text-[#64748B] mb-6">{mode === "signup" ? "Start managing Telegram messaging" : "Sign in to continue"}</p>
        {mode === "signup" && <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 mb-3 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none transition" />}
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 mb-3 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none transition" />
        {mode === "signup" && <div className="relative mb-3"><span className="absolute left-3.5 top-3.5 text-slate-400 text-sm">@</span><input value={tgUser} onChange={e => setTgUser(e.target.value)} placeholder="Telegram username (optional)" className="w-full border border-[#E2E8F0] rounded-xl pl-8 pr-3.5 py-3 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none transition" /></div>}
        <input value={pass} onChange={e => setPass(e.target.value)} placeholder="Password" type="password" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 mb-2 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none transition" />
        {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-2.5 mb-3">{err}</div>}
        <button onClick={submit} disabled={loading} className="w-full bg-[#229ED9] text-white py-3 rounded-full font-semibold hover:bg-[#1B8AC4] shadow-lg transition disabled:opacity-50">{loading ? "..." : mode === "signup" ? "Create Account" : "Sign In"}</button>
        <button className="w-full mt-3 border border-[#E2E8F0] py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#F8FAFC] transition"><img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="" className="w-4 h-4" />Continue with Google</button>
        <p className="text-sm text-center mt-5 text-[#64748B]">{mode === "signup" ? "Already have an account? " : "No account? "}<button onClick={() => onNav(mode === "signup" ? "login" : "signup")} className="text-[#229ED9] font-semibold">{mode === "signup" ? "Login" : "Create one"}</button></p>
        <button onClick={() => onNav("landing")} className="text-xs font-medium text-[#64748B] mx-auto block mt-4 hover:text-slate-900">← Back to home</button>
      </div>
    </div>
  );
}

function Connect({ onNav }: { onNav: (v: string) => void }) {
  const { setTg, tgAccounts, refreshTgAccounts, setActiveTgId } = useStore() as any;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [phone, setPhone] = useState("+91 "), [code, setCode] = useState(""), [pwd, setPwd] = useState("");
  const [hash, setHash] = useState(""), [loading, setLoading] = useState(false), [err, setErr] = useState("");
  const count = tgAccounts?.length || 0;
  const sendCode = async () => {
    setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/telegram/send-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.trim() }) });
      const txt = await r.text(); let j: any = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { throw new Error(txt?.slice(0,300) || `Server returned ${r.status} with empty body — check terminal for [send-code] error. Did you set TELEGRAM_API_ID/HASH and restart?`); }
      if (!r.ok) throw new Error(j.error || txt.slice(0,300) || `HTTP ${r.status}`); setHash(j.phoneCodeHash); setStep(2);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  const verify = async (needPwd = false) => {
    setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/telegram/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.trim(), code: code.trim(), password: pwd, phoneCodeHash: hash }) });
      const txt = await r.text(); let j: any = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { throw new Error(txt?.slice(0,300) || `Server returned ${r.status} with empty body`); }
      if (!r.ok) throw new Error(j.error || txt.slice(0,300) || `HTTP ${r.status}`);
      if (j.needPassword) { setStep(3); return; }
      setTg({ username: j.username, phone, connected: true, displayName: j.displayName, firstName: j.firstName, photo: null });
      if (j.accountId) setActiveTgId(j.accountId);
      await refreshTgAccounts();
      onNav("dashboard");
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="bg-white border border-[#E2E8F0] rounded-[24px] p-8 w-full max-w-md shadow-2xl shadow-black/10">
        <div className="flex gap-2 mb-6">{[1,2,3].map(n=> <div key={n} className={`flex-1 h-1.5 rounded-full ${n<=step?'bg-[#229ED9]':'bg-[#E2E8F0]'}`} />)}</div>
        <h2 className="text-xl font-extrabold tracking-tight">{count ? "Add Telegram Account" : "Connect Your Telegram Account"}</h2>
        <p className="text-sm text-[#64748B] mb-2 leading-6">{count ? `You have ${count}/10 accounts. Add another number — all linked to this email.` : "We keep your session encrypted server-side (httpOnly cookie). Enter the code Telegram sends you."}</p>
        {count > 0 && <div className="text-xs font-semibold bg-[#F1F5F9] border border-[#E2E8F0] rounded-full px-3 py-1.5 inline-block mb-4">{count}/10 accounts connected</div>}
        {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{err}</div>}
        {step === 1 && <><label className="text-sm font-semibold">Telegram Phone Number</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 mt-1.5 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none" /><button onClick={sendCode} disabled={loading} className="w-full bg-[#229ED9] text-white py-3 rounded-full font-semibold mt-5 shadow-lg disabled:opacity-50">{loading ? "Sending..." : "Send Verification Code"}</button><button onClick={() => onNav("dashboard")} className="text-xs font-medium text-[#64748B] mx-auto block mt-3 hover:text-slate-900">← Back to dashboard</button></>}
        {step === 2 && <><label className="text-sm font-semibold">Verification Code</label><input value={code} onChange={e => setCode(e.target.value)} placeholder="Code from Telegram" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 mt-1.5 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none" /><button onClick={() => verify()} disabled={loading} className="w-full bg-[#229ED9] text-white py-3 rounded-full font-semibold mt-5 shadow-lg disabled:opacity-50">{loading ? "Verifying..." : "Verify Account"}</button><button onClick={() => setStep(1)} className="text-xs font-medium text-[#64748B] mt-3">← Change number</button></>}
        {step === 3 && <><label className="text-sm font-semibold">Two-Step Verification Password</label><input value={pwd} onChange={e => setPwd(e.target.value)} placeholder="Telegram 2FA Password" type="password" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 mt-1.5 text-sm" /><button onClick={() => verify(true)} disabled={loading} className="w-full bg-[#229ED9] text-white py-3 rounded-full font-semibold mt-5 disabled:opacity-50">{loading ? "Checking..." : "Complete Connection"}</button><button onClick={() => setStep(2)} className="text-xs font-medium text-[#64748B] mt-3">← Back</button></>}
      </div>
    </div>
  );
}

function AccountsView() {
  const { tgAccounts, activeTgId, setActiveTgId, setTg, refreshTgAccounts, refreshDests, setView, campaigns } = useStore() as any;
  const [switching, setSwitching] = useState<string | null>(null);
  const [perAccount, setPerAccount] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await fetch("/api/stats"); const j = await r.json(); if (alive && j.perAccount) setPerAccount(j.perAccount); } catch {}
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [tgAccounts?.length, campaigns?.length]);
  const doSwitch = async (id: string) => {
    setSwitching(id);
    try {
      const r = await fetch("/api/telegram/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: id }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setActiveTgId(id);
      const acc = tgAccounts.find((a: any) => a.id === id);
      if (acc) setTg({ username: acc.username, phone: acc.phone, connected: true, displayName: acc.displayName, firstName: acc.firstName });
      await refreshTgAccounts();
      try { await refreshDests(); } catch {}
    } catch (e: any) { alert(e.message); } finally { setSwitching(null); }
  };
  const doRemove = async (id: string) => {
    if (!confirm("Remove this Telegram account? You can reconnect it anytime.")) return;
    try { const r = await fetch(`/api/telegram/accounts?id=${id}`, { method: "DELETE" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); await refreshTgAccounts(); if (activeTgId === id) try { await refreshDests(); } catch {} } catch (e: any) { alert(e.message); }
  };
  const count = tgAccounts?.length || 0;
  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap gap-4 justify-between items-start">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">Telegram Accounts</h1>
          <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">Manage your connected Telegram identities. The active account is used for all campaigns and groups.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium bg-white border border-slate-200 px-3 py-1.5 rounded-full text-slate-600">{count}/10 connected</span>
          {count > 0 && count < 10 && <button onClick={() => setView("connect")} className="bg-[#229ED9] text-white px-4 py-2 rounded-full text-xs font-semibold hover:bg-[#1B8AC4] transition">+ Add account</button>}
        </div>
      </div>

      <div className="mt-4 bg-[#229ED9] text-white rounded-2xl px-4 py-3 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0"><Shield size={13} className="text-white" /></div>
        <p className="text-xs leading-relaxed text-white/80"><span className="font-semibold text-white">Active account controls everything</span> — campaigns, groups and delivery logs always use the active one. Switch anytime.</p>
        <span className="hidden sm:inline-flex ml-auto text-[10px] font-bold tracking-widest bg-white text-slate-900 px-2.5 py-1 rounded-full shrink-0">{count}/10</span>
      </div>

      {!tgAccounts?.length ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 mt-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#229ED9] flex items-center justify-center mx-auto"><Users size={18} className="text-white" /></div>
          <div className="text-[15px] font-semibold text-slate-900 mt-4">No Telegram accounts yet</div>
          <div className="text-[13px] text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">Connect your first Telegram number. You can add up to 10 accounts to this email and switch between them instantly.</div>
          <button onClick={() => setView("connect")} className="mt-5 bg-[#229ED9] text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-[#1B8AC4] transition">Connect Telegram</button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {tgAccounts.map((a: any) => {
            const active = a.id === activeTgId;
            const initial = (a.displayName || a.username || a.phone || "?")[0].toUpperCase();
            return (
              <div key={a.id} className={`group bg-white border rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between transition ${active ? "border-slate-900 shadow-sm" : "border-slate-200 hover:border-slate-300"}`}>
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 border ${active ? "bg-[#229ED9] text-white border-slate-900" : "bg-slate-50 text-slate-700 border-slate-200"}`}>{initial}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-slate-900 truncate">{a.displayName || a.username || a.phone}</span>
                      {active && <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />ACTIVE</span>}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">{a.username ? `@${a.username}` : a.phone} <span className="mx-1 text-slate-300">·</span> {a.phone}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Added {new Date(a.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} · {new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    {(() => { const st = perAccount?.find((x:any)=> String(x.accountId)===String(a.id)); const sent = st ? st.totalSent : 0; const groups = st ? st.uniqueGroups : 0; const camps = st ? st.totalCampaigns : 0; return (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full"><Send size={11} />{Number(sent).toLocaleString()} messages</span>
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-[#EFF6FF] text-blue-700 border border-[#BFDBFE] px-2.5 py-1 rounded-full"><Users size={11} />{Number(groups).toLocaleString()} groups</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full">{camps} campaigns{st?.running ? <span className="w-1.5 h-1.5 bg-[#EFF6FF]0 rounded-full animate-pulse ml-1" /> : null}</span>
                    </div>
                    ); })()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  {active ? (
                    <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-full">Active for sending</span>
                  ) : (
                    <button onClick={() => doSwitch(a.id)} disabled={!!switching} className="bg-[#229ED9] text-white px-4 py-2 rounded-full text-xs font-semibold hover:bg-[#1B8AC4] disabled:opacity-50 transition">{switching === a.id ? "Switching…" : "Set active"}</button>
                  )}
                  <button onClick={() => doRemove(a.id)} className="w-8 h-8 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition" aria-label="Remove"><X size={13} /></button>
                </div>
              </div>
            );
          })}
          {count < 10 ? (
            <button onClick={() => setView("connect")} className="w-full bg-white border border-dashed border-slate-300 text-slate-700 rounded-2xl py-3.5 text-sm font-semibold hover:border-slate-900 hover:text-slate-900 hover:bg-slate-50 transition flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-[#229ED9] text-white flex items-center justify-center text-sm leading-none">+</span> Add Telegram account <span className="text-xs font-medium text-slate-400">· {count}/10 used</span></button>
          ) : (
            <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">Limit reached — 10 accounts max. Remove one to add another.</div>
          )}
          <p className="text-[11px] text-slate-400 text-center leading-relaxed">Switching instantly updates Groups, Campaigns and Delivery Logs to the new active account.</p>
        </div>
      )}
    </div>
  );
}

function RentAccountsView() {
  const { refreshTgAccounts, setActiveTgId, setTg, tgAccounts } = useStore() as any;
  const [pool, setPool] = useState<any[]>([]);
  const [rentals, setRentals] = useState<any[]>([]);
  const [myActive, setMyActive] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const load = async () => {
    setLoading(true); setErr("");
    try { const r = await fetch("/api/rentals"); const j = await r.json(); if (!r.ok) throw new Error(j.error); setPool(j.pool || []); setRentals(j.rentals || []); setMyActive(j.myActive || []); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const fmtLeft = (expiresAt: string) => {
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return "Expired";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")} left`;
  };
  const [subRent, setSubRent] = useState<any>(null);
  const [freeLeft, setFreeLeft] = useState<number>(0);
  const [freeUsed, setFreeUsed] = useState<number>(0);
  const loadSub = async () => {
    try {
      const r = await fetch("/api/subscription", { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j.plan) {
        setSubRent(j.plan);
        // subscription API returns freeRentUsedToday + freeRentPerDay — compute freeLeft
        const perDay = j.plan.freeRentPerDay ?? 0;
        const used = j.usage?.freeRentUsedToday ?? j.usage?.freeUsed ?? 0;
        const left = j.usage?.freeLeft != null ? j.usage.freeLeft : Math.max(0, perDay - used);
        setFreeLeft(left);
        setFreeUsed(used);
      } else if (r.ok) {
        setSubRent(null); setFreeLeft(0); setFreeUsed(0);
      }
    } catch {}
  };
  useEffect(() => { loadSub(); }, []);
  const payAndRent = async (poolId: string, useFree = false) => {
    setPayingId(poolId); setErr(""); setOkMsg("");
    try {
      const r = await fetch("/api/rentals/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ poolAccountId: poolId, useFree }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setOkMsg(j.isFree ? `✓ Free rented account added — 24h (free ${subRent?.freeRentPerDay ? `1/${subRent.freeRentPerDay} today` : ""}). Expires ${new Date(j.expiresAt).toLocaleString()}` : `✓ Rented for 24 hours — account added to your senders. Expires ${new Date(j.expiresAt).toLocaleString()}`);
      await load(); await refreshTgAccounts(); await loadSub();
      if (j.tgAccountId) { setActiveTgId(j.tgAccountId); const acc = (tgAccounts || []).find((a: any) => a.id === j.tgAccountId); if (acc) setTg({ username: acc.username, phone: acc.phone, connected: true, displayName: acc.displayName, firstName: acc.firstName }); }
      setTimeout(() => setOkMsg(""), 5000);
    } catch (e: any) { setErr(e.message); } finally { setPayingId(null); }
  };
  const available = pool.filter((p: any) => p.status === "available").length;
  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap gap-3 justify-between items-start">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 flex items-center gap-2"><span className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-sm">⭐</span> Rent Accounts</h1>
          <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">Don&apos;t want to risk your personal account? Rent a sender for 24 hours — pay once, it&apos;s auto-added to your senders and you can choose it for any campaign.</p>
        </div>
        <button onClick={load} disabled={loading} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center"><div className="text-[11px] font-bold tracking-widest text-slate-400">AVAILABLE NOW</div><div className="text-2xl font-extrabold text-emerald-600 mt-1">{available}</div><div className="text-[11px] text-slate-500">of {pool.length} senders</div></div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center"><div className="text-[11px] font-bold tracking-widest text-slate-400">YOUR ACTIVE RENTALS</div><div className="text-2xl font-extrabold text-slate-900 mt-1">{myActive.length}</div><div className="text-[11px] text-slate-500">auto-added as senders</div></div>
        <div className={`rounded-2xl p-4 text-center ${subRent ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white" : "bg-gradient-to-br from-amber-500 to-orange-600 text-white"}`}><div className="text-[11px] font-bold tracking-widest text-white/80">{subRent ? `${subRent.name.toUpperCase()} · FREE LEFT` : "PRICE"}</div><div className="text-2xl font-extrabold mt-1">{subRent ? `${freeLeft} / ${subRent.freeRentPerDay}` : "$1"}</div><div className="text-[11px] text-white/80">{subRent ? `${freeUsed} used today · ${freeLeft} left` : "per account / 24 hours"}</div></div>
      </div>
      {subRent && subRent.freeRentPerDay > 0 && <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-800">Your plan <b>{subRent.name}</b> gives <b>{subRent.freeRentPerDay} free rented account(s) per day</b> — use &quot;Claim Free&quot; below. Paid rent is always available too.</div>}
      {subRent && subRent.freeRentPerDay === 0 && <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">Elite has no free rentals — upgrade to Pro/Max+/Luxe for free rented accounts.</div>}
      {!subRent && <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">No active plan — <button onClick={() => (window as any).__setView?.("plans")} className="underline font-bold">activate a plan</button> to get free rentals. Paid rent still works.</div>}

      {err && <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{err}</div>}
      {okMsg && <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3">{okMsg}</div>}

      {myActive.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Your rented senders — selectable in Create Campaign</h3>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {myActive.map((r: any) => (
              <div key={r.id} className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#229ED9] text-white flex items-center justify-center font-semibold text-sm">{(r.displayName || r.username || "?")[0].toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 truncate">{r.displayName} {r.username ? `@${r.username}` : ""}</div>
                    <div className="text-xs text-slate-500 truncate">{r.phone}</div>
                  </div>
                  <span className="text-[10px] font-bold tracking-widest bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full">RENTED</span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="bg-white border border-emerald-200 px-2.5 py-1 rounded-full font-semibold text-emerald-700">⏳ {fmtLeft(r.expiresAt)}</span>
                  <span className="text-slate-400">${r.price} · 24h</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-2">Expires {new Date(r.expiresAt).toLocaleString()} — auto-removed after.</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-900">Marketplace — rent in one click</h3>
        <p className="text-xs text-slate-500 mt-1">Payment is mock for now (instant success). Replace <code className="bg-slate-50 px-1 rounded">/api/rentals/pay</code> with Razorpay/Stripe later — rented account is auto-added to your Accounts & sender dropdown.</p>
        {loading ? <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">Loading marketplace…</div> : (
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            {pool.map((p: any) => {
              const isMine = p.isMine;
              const avail = p.status === "available";
              return (
                <div key={p.id} className={`bg-white border rounded-2xl p-4 flex flex-col gap-3 ${isMine ? "border-emerald-300 bg-emerald-50/50" : avail ? "border-slate-200 hover:border-slate-300" : "border-slate-200 opacity-60"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm shrink-0 ${avail ? "bg-[#229ED9] text-white" : "bg-slate-50 text-slate-500 border border-slate-200"}`}>{(p.displayName || p.username || "?")[0].toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">{p.displayName}</div>
                      <div className="text-xs text-slate-500 truncate">{p.username ? `@${p.username}` : ""} · {p.phone}</div>
                    </div>
                    {isMine ? <span className="text-[10px] font-bold tracking-widest bg-emerald-600 text-white px-2 py-1 rounded-full">YOURS</span> : avail ? <span className="text-[10px] font-bold tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-full">AVAILABLE</span> : <span className="text-[10px] font-bold tracking-widest bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full">RENTED</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold bg-[#229ED9] text-white px-3 py-1.5 rounded-full">${p.pricePerDay} / 24h</span>
                    {isMine ? <span className="text-xs text-emerald-700 font-medium">Already in your senders ✓</span> : avail ? <>
                      {subRent && subRent.freeRentPerDay > 0 && freeLeft > 0 && <button onClick={() => payAndRent(p.id, true)} disabled={!!payingId} className="bg-emerald-600 text-white px-4 py-2 rounded-full text-xs font-bold shadow disabled:opacity-50">{payingId === p.id ? "…" : "Claim Free →"}</button>}
                      <button onClick={() => payAndRent(p.id, false)} disabled={!!payingId} className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-4 py-2 rounded-full text-xs font-bold shadow disabled:opacity-50">{payingId === p.id ? "Processing…" : "Pay & Rent →"}</button>
                    </> : <span className="ml-auto text-xs text-slate-400">Unavailable</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <div className="text-xs font-bold tracking-widest text-amber-800">HOW IT WORKS</div>
        <ol className="mt-2 text-xs text-amber-900/80 leading-6 list-decimal list-inside">
          <li>Click <b>Pay & Rent</b> — payment succeeds instantly (mock).</li>
          <li>Account is <b>auto-added</b> to your Accounts & appears in <b>Create Campaign → Sender</b> dropdown.</li>
          <li>Choose it for any campaign — sending uses the rented account&apos;s session, not your personal one.</li>
          <li>After 24 hours it&apos;s <b>auto-removed</b> and returns to the pool. No manual cleanup.</li>
        </ol>
        <div className="text-[11px] text-amber-700/70 mt-2">To use real payments: wire Razorpay/Stripe in <code className="bg-white px-1 rounded border">src/app/api/rentals/pay/route.ts</code> and verify signature before creating the rental.</div>
      </div>
    </div>
  );
}

function PlansView() {
  const [billing, setBilling] = useState<"daily" | "monthly">("monthly");
  const [sub, setSub] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  // Crypto checkout — Buy Now → Gateway → Crypto → auto API key + auto subscription
  const [cryptoPaying, setCryptoPaying] = useState<string | null>(null);
  const [cryptoOrders, setCryptoOrders] = useState<any[]>([]);
  const [cryptoPolling, setCryptoPolling] = useState<string | null>(null);
  const [gatewayPlan, setGatewayPlan] = useState<{ id: string; billing: "daily" | "monthly"; name: string; price: string } | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    try { const r = await fetch("/api/subscription"); const j = await r.json(); if (r.ok) { setSub(j.subscription); setPlan(j.plan); setUsage(j.usage); } } catch {}
    try { const r = await fetch("/api/payments/crypto/status"); const j = await r.json(); if (r.ok && j.payments) setCryptoOrders(j.payments); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  // Poll for crypto payment status when waiting — auto-activates on finished
  useEffect(() => {
    if (!cryptoPolling) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/payments/crypto/status?orderId=${cryptoPolling}`);
        const j = await r.json();
        if (!alive) return;
        if (j.payment) {
          setCryptoOrders(prev => {
            const idx = prev.findIndex((x: any) => x.orderId === cryptoPolling);
            if (idx >= 0) { const c = [...prev]; c[idx] = j.payment; return c; }
            return [j.payment, ...prev];
          });
          if (j.payment.licenseKey) {
            setSuccessKey(j.payment.licenseKey);
            setMsg(`✅ Payment confirmed! API Key: ${j.payment.licenseKey} — plan auto-activated! Check Active Plan above.`);
            setKey(j.payment.licenseKey);
            setCryptoPolling(null);
            await load();
            return;
          }
          if (["failed", "expired", "refunded"].includes(j.payment.status)) {
            setErr(`Payment ${j.payment.status} — try again or contact support.`);
            setCryptoPolling(null);
            return;
          }
        }
      } catch {}
      if (alive) setTimeout(poll, 5000);
    };
    const t = setTimeout(poll, 3000);
    return () => { alive = false; clearTimeout(t); };
  }, [cryptoPolling]);
  // Handle return from NOWPayments success/cancel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get("order");
    const cryptoStatus = params.get("crypto");
    if (order && cryptoStatus) {
      setCryptoPolling(order);
      if (cryptoStatus === "success") setMsg("Payment page completed — waiting for blockchain confirmation. Your API key & plan will auto-activate here.");
      else if (cryptoStatus === "cancel") setErr("Payment cancelled — you can try again.");
      window.history.replaceState({}, "", window.location.pathname);
      load();
    }
  }, []);
  const isMonthlyPlans = billing === "monthly";
  const cards = [
    { id: "elite", name: "Elite", daily: "$2", monthly: "$55", feats: ["10 groups / campaign", isMonthlyPlans ? "300 campaigns / month" : "10 campaigns / day", "Repeat min 15 min", "No free rented accounts"], color: "from-slate-700 to-slate-900", icon: Gem, iconBg: "bg-slate-50", iconColor: "text-slate-700" },
    { id: "pro", name: "Pro", daily: "$5", monthly: "$150", feats: ["100 groups / campaign", isMonthlyPlans ? "900 campaigns / month" : "30 campaigns / day", "Repeat from 1 min", isMonthlyPlans ? "30 rented accounts / month free" : "1 rented account / day free"], color: "bg-[#229ED9]", icon: ZapIcon, iconBg: "bg-sky-100", iconColor: "text-[#229ED9]" },
    { id: "max_plus", name: "Max+", daily: "$12", monthly: "$299", feats: ["1,000 groups / campaign", "Unlimited campaigns", "No repeat limit", isMonthlyPlans ? "90 rented accounts / month free" : "3 rented accounts / day free"], popular: true, color: "from-violet-600 to-indigo-700", icon: Diamond, iconBg: "bg-violet-100", iconColor: "text-violet-600" },
    { id: "luxe", name: "Luxe", daily: null, monthly: "$1300", feats: ["10,000+ groups / campaign", "Unlimited everything", "10 rented accounts / day free", "VIP 24/7 dedicated support"], vip: true, color: "from-amber-500 via-orange-500 to-pink-600", icon: Crown, iconBg: "bg-amber-100", iconColor: "text-amber-600" },
  ];
  const openGateway = (planId: string, billingMode: "daily" | "monthly") => {
    const card = cards.find(c => c.id === planId);
    const price = card ? (planId === "luxe" ? card.monthly! : billingMode === "monthly" ? card.monthly! : card.daily!) : "";
    setGatewayPlan({ id: planId, billing: billingMode, name: card?.name || planId, price });
  };
  const payWithCrypto = async () => {
    if (!gatewayPlan) return;
    const k = `${gatewayPlan.id}:${gatewayPlan.billing}`;
    const win = window.open("about:blank", "_blank");
    if (win) win.document.write('<p style="font-family:sans-serif;text-align:center;margin-top:40px">Creating invoice… please wait</p>');
    setCryptoPaying(k); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/payments/crypto/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: gatewayPlan.id, billing: gatewayPlan.billing }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setCryptoPolling(j.orderId);
      try { const rr = await fetch("/api/payments/crypto/status"); const jj = await rr.json(); if (jj.payments) setCryptoOrders(jj.payments); } catch {}
      setGatewayPlan(null);
      if (win && !win.closed) win.location.href = j.invoiceUrl;
      else window.location.href = j.invoiceUrl;
      setMsg(`Crypto invoice created for ${gatewayPlan.name} ${gatewayPlan.billing} — $${j.amountUsd}. Complete payment in the new tab. Your API key & plan will auto-activate after confirmation.`);
    } catch (e: any) {
      if (win && !win.closed) win.close();
      setErr(e.message);
    } finally { setCryptoPaying(null); }
  };
  const redeem = async () => {
    if (!key.trim()) { setErr("Enter license key"); return; }
    setRedeeming(true); setErr(""); setMsg("");
    try { const r = await fetch("/api/keys/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: key.trim() }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMsg(j.message); setKey(""); await load(); } catch (e: any) { setErr(e.message); } finally { setRedeeming(false); }
  };
  const activeId = sub?.planId || null;
  return (
    <div className="max-w-5xl">
      <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">Plans & Billing</h1>
      <p className="text-[13px] text-slate-500 mt-1"><b>Buy Now</b> → choose gateway → <b>Pay with Crypto</b> → <b>API key auto-generated</b> & plan auto-activated. No manual redeem needed.</p>

      <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5">
        <div>
          <div className="text-xs font-bold tracking-widest text-slate-400">ACTIVE PLAN</div>
          {loading ? <div className="text-sm text-slate-500 mt-1">Loading…</div> : plan ? (
            <div className="mt-1">
              <div className="flex items-center gap-2"><span className={`text-sm font-bold bg-gradient-to-r ${cards.find(c=>c.id===plan.id)?.color} text-white px-3 py-1 rounded-full`}>{plan.name}</span><span className="text-xs font-semibold text-slate-600">{sub.billing === "daily" ? "Daily" : "Monthly"} · expires {new Date(sub.expiresAt).toLocaleString()}</span><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /></div>
              <div className="text-xs text-slate-500 mt-2">Campaigns today: <b>{usage?.campaignsToday ?? 0}{usage?.campaignsLimit ? ` / ${usage.campaignsLimit}` : " / Unlimited"}</b> · Free rent today: <b>{usage?.freeRentUsedToday ?? 0} / {usage?.freeRentPerDay ?? 0}</b></div>
            </div>
          ) : <div className="mt-1 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">No active plan — redeem a key below to activate.</div>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="Enter license key — e.g. PRO-M-XXXX-XXXX-XXXX" className="flex-1 min-w-[240px] border border-slate-200 rounded-full px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-slate-900 outline-none" />
          <button onClick={redeem} disabled={redeeming} className="bg-[#229ED9] text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-[#1B8AC4] disabled:opacity-50">{redeeming ? "Activating…" : "Redeem & Activate →"}</button>
        </div>
        {err && <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">{err}</div>}
        {msg && <div className="mt-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-3 py-2">{msg}</div>}
        <p className="text-[11px] text-slate-400 mt-2">Crypto: <b>Buy Now → Pay with Crypto</b> → API key auto-generated & plan auto-activated. Daily 24h, monthly 30 days. Manual redeem still works if needed.</p>
      </div>

      {successKey && (
        <div className="mt-4 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 text-white shadow-lg shadow-emerald-500/20">
          <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-white/80">✅ PAYMENT SUCCESSFUL — API KEY GENERATED</div>
          <div className="mt-2 font-mono text-sm font-bold bg-white text-emerald-700 rounded-xl px-4 py-3 flex flex-wrap gap-2 items-center justify-between">
            <span className="break-all">{successKey}</span>
            <button onClick={() => { navigator.clipboard.writeText(successKey); setMsg("Copied " + successKey); }} className="bg-emerald-600 text-white px-3 py-1 rounded-full text-xs font-bold shrink-0">Copy</button>
          </div>
          <div className="text-xs text-white/80 mt-2">Your plan is already <b>auto-activated</b> — check Active Plan above. This is your API key (license key) — save it!</div>
          <button onClick={() => setSuccessKey(null)} className="mt-3 text-xs font-bold bg-white/15 border border-white/20 px-3 py-1.5 rounded-full hover:bg-white/25">Dismiss</button>
        </div>
      )}

      {/* Crypto orders — show pending/confirmed keys */}
      {cryptoOrders.length > 0 && (
        <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold flex items-center gap-2">₿ Crypto Orders</h3>
            <a href="https://t.me/princerana" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold bg-[#229ED9] text-white px-3.5 py-1.5 rounded-full hover:bg-[#1B8AC4] hover:shadow-md transition shrink-0">
              <MessageCircle size={12} /> Support
            </a>
          </div>
          <p className="text-xs text-slate-500 mt-1">Your crypto invoices — status updates automatically. On <b>finished</b>, your API key is auto-generated & plan auto-activated.</p>
          <div className="mt-3 space-y-2">
            {cryptoOrders.slice(0, 10).map((o: any) => (
              <div key={o.orderId} className={`flex flex-wrap gap-2 items-center justify-between rounded-xl px-3.5 py-3 border text-sm ${o.licenseKey ? "bg-emerald-50 border-emerald-200" : o.status === "failed" || o.status === "expired" ? "bg-red-50 border-red-200" : o.status === "finished" || o.status === "confirmed" ? "bg-blue-50 border-blue-200" : "bg-slate-50 border-slate-200"}`}>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{o.planId} · {o.billing} · ${o.amountUsd} {o.payCurrency ? `· ${o.payCurrency.toUpperCase()}` : ""}</div>
                  <div className="text-xs text-slate-500">{new Date(o.createdAt).toLocaleString()} · {o.orderId}</div>
                  {o.licenseKey && <div className="mt-1 font-mono text-xs font-bold text-emerald-700 bg-white border border-emerald-200 rounded-full px-3 py-1 inline-flex flex-wrap items-center gap-2"><span>{o.licenseKey}</span> <button onClick={() => { navigator.clipboard.writeText(o.licenseKey); setMsg("Copied " + o.licenseKey); }} className="text-emerald-600 hover:text-emerald-800 text-[10px] font-bold">Copy</button> <span className="text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">AUTO-ACTIVATED ✓</span></div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${o.status === "finished" ? "bg-emerald-600 text-white border-emerald-600" : o.status === "confirmed" ? "bg-blue-600 text-white border-blue-600" : o.status === "waiting" || o.status === "confirming" ? "bg-amber-100 text-amber-700 border-amber-200" : o.status === "failed" || o.status === "expired" ? "bg-red-100 text-red-700 border-red-200" : "bg-white border-slate-200"}`}>{o.status.toUpperCase()}</span>
                  {o.invoiceUrl && !o.licenseKey && <a href={o.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full hover:bg-slate-50">Open Invoice →</a>}
                  {!o.licenseKey && <button onClick={async () => { try { const r = await fetch("/api/payments/crypto/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.orderId }) }); const j = await r.json(); if (j.payment) setCryptoOrders(prev => prev.map(x => x.orderId === o.orderId ? j.payment : x)); if (j.licenseKey) { setSuccessKey(j.licenseKey); setMsg(j.message || `✅ Verified! API Key: ${j.licenseKey} — plan auto-activated!`); await load(); } else if (j.message) setMsg(j.message); if (j.canForce && !j.licenseKey) { if (confirm(j.message + "\n\nOn localhost, click OK to Force Confirm (test) and generate your API key now.")) { const rr = await fetch("/api/payments/crypto/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.orderId, force: true }) }); const jj = await rr.json(); if (jj.licenseKey) { setSuccessKey(jj.licenseKey); setMsg(jj.message); setCryptoOrders(prev => prev.map(x => x.orderId === o.orderId ? jj.payment : x)); await load(); } else setErr(jj.error || jj.message); } } } catch (e:any) { setErr(e.message); } }} className="text-xs font-bold bg-[#229ED9] text-white px-3 py-1.5 rounded-full hover:bg-[#1B8AC4]">Verify Payment</button>}
                  {o.licenseKey && <span className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-full">Active ✓</span>}
                </div>
              </div>
            ))}
          </div>
          {cryptoPolling && <div className="mt-3 text-xs font-semibold text-[#229ED9] flex items-center gap-2"><span className="w-3 h-3 border-2 border-[#229ED9]/30 border-t-[#229ED9] rounded-full animate-spin" /> Waiting for blockchain confirmation — polling every 5s…</div>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">Need help with payment? Contact support on Telegram</span>
            <a href="https://t.me/princerana" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold bg-[#229ED9] text-white px-4 py-2 rounded-full hover:bg-[#1B8AC4] transition">
              <Send size={12} /> @princerana — Support
            </a>
          </div>
        </div>
      )}

      <div className="flex justify-center mt-6">
        <div className="bg-white border border-[#E2E8F0] rounded-full p-1 flex gap-1 shadow-sm">
          <button onClick={() => setBilling("daily")} className={`px-6 py-2 rounded-full text-sm font-bold transition ${billing === "daily" ? "bg-[#229ED9] text-white shadow" : "text-[#64748B] hover:text-slate-900"}`}>Daily</button>
          <button onClick={() => setBilling("monthly")} className={`px-6 py-2 rounded-full text-sm font-bold transition ${billing === "monthly" ? "bg-[#229ED9] text-white shadow" : "text-[#64748B] hover:text-slate-900"}`}>Monthly <span className="text-[10px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full ml-1">SAVE</span></button>
        </div>
      </div>

      <div className="mt-6 grid md:grid-cols-4 gap-4">
        {cards.map((c: any) => {
          const isActive = activeId === c.id;
          const Icon = c.icon;
          const isLuxeCard = c.id === "luxe";
          return (
            <div key={c.id} className={`group bg-white border rounded-[20px] p-5 flex flex-col relative overflow-hidden transition-all hover:shadow-lg ${isActive ? "border-emerald-400 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-200" : c.popular ? "border-violet-300 shadow-xl shadow-violet-500/15" : c.vip ? "border-amber-300 shadow-md" : "border-slate-200 hover:border-slate-300"}`}>
              {isActive && <div className="absolute top-0 right-0 bg-emerald-600 text-white text-[10px] font-bold tracking-widest px-3 py-1 rounded-bl-xl">ACTIVE</div>}
              {c.popular && !isActive && <div className="absolute top-0 right-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[10px] font-bold tracking-widest px-3 py-1 rounded-bl-xl">MOST POPULAR</div>}
              {c.vip && !isActive && <div className="absolute top-0 right-0 bg-gradient-to-r from-amber-500 to-pink-600 text-white text-[10px] font-bold tracking-widest px-3 py-1 rounded-bl-xl flex items-center gap-1"><Crown size={10} /> VIP</div>}
              <div className={`w-11 h-11 rounded-xl ${c.iconBg} flex items-center justify-center ${isActive || c.popular || c.vip ? "mt-4" : ""}`}><Icon size={20} className={c.iconColor} /></div>
              <div className="font-bold mt-3 flex items-center gap-1.5">{c.name} {c.vip && <Sparkles size={14} className="text-amber-500" />}</div>
              <div className="text-2xl font-extrabold tracking-tight mt-1">{isLuxeCard ? c.monthly : isMonthlyPlans ? c.monthly : c.daily}<span className="text-xs font-medium text-slate-400">{isLuxeCard ? "/mo" : isMonthlyPlans ? "/mo" : "/day"}</span></div>
              <div className="text-[11px] text-slate-400">{isLuxeCard ? "Monthly only" : isMonthlyPlans ? `or ${c.daily}/day` : `or ${c.monthly}/mo`}</div>
              <ul className="mt-3 space-y-1.5 text-xs flex-1">{c.feats.map((f: string) => <li key={f} className="flex gap-1.5"><Check size={12} className="text-emerald-600 mt-0.5 shrink-0" /><HoverTip tip={featTip(f)}><span className="border-b border-dotted border-slate-300 decoration-slate-300 underline-offset-2">{f}</span></HoverTip></li>)}</ul>
              {isActive ? <div className="mt-3 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5 text-center">Active till {new Date(sub.expiresAt).toLocaleDateString()}</div> : (
                <div className="mt-3 space-y-2">
                  <button onClick={() => openGateway(c.id, isLuxeCard ? "monthly" : (billing as any))} className={`w-full py-2.5 rounded-full text-xs font-bold text-center transition flex items-center justify-center gap-1.5 ${c.popular ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow hover:shadow-lg" : c.vip ? "bg-gradient-to-r from-amber-500 to-pink-600 text-white shadow hover:shadow-lg" : "bg-[#229ED9] text-white hover:bg-[#1B8AC4]"}`}>Buy Now</button>
                  <div className="text-[10px] text-center text-slate-400">BTC · ETH · USDT · TON · SOL · 300+ coins via NOWPayments</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm">Compare all plans</div>
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 py-2">FEATURE</th><th className="px-3 py-2">ELITE</th><th className="px-3 py-2">PRO</th><th className="px-3 py-2">MAX+</th><th className="px-3 py-2">LUXE</th></tr></thead>
          <tbody className="text-sm">
            {[
              ["Price daily", "$2", "$5", "$12", "—"],
              ["Price monthly", "$55", "$150", "$299", "$1300"],
              ["Groups / campaign", "10", "100", "1,000", "10,000+"],
              ["Campaigns / day", "10", "30", "Unlimited", "Unlimited"],
              ["Repeat min", "15 min", "1 min", "No limit", "No limit"],
              ["Free rented / day", "0", "1", "3", "10"],
              ["Support", "Standard", "Priority", "Priority", "VIP 24/7"],
            ].map(([f,a,b,c,d]) => <tr key={f} className="border-t border-slate-100"><td className="px-4 py-2.5 font-semibold">{f}</td><td className="px-3 py-2.5 text-center"><HoverTip tip={rowTip(f,a)}><span className="border-b border-dotted border-slate-300">{a}</span></HoverTip></td><td className="px-3 py-2.5 text-center font-semibold bg-[#EFF6FF]/50"><HoverTip tip={rowTip(f,b)}><span className="border-b border-dotted border-slate-300">{b}</span></HoverTip></td><td className="px-3 py-2.5 text-center"><HoverTip tip={rowTip(f,c)}><span className="border-b border-dotted border-slate-300">{c}</span></HoverTip></td><td className="px-3 py-2.5 text-center font-bold text-amber-700 bg-amber-50/50"><HoverTip tip={rowTip(f,d)}><span className="border-b border-dotted border-amber-300">{d}</span></HoverTip></td></tr>)}
          </tbody>
        </table>
      </div>

      {gatewayPlan && (
        <GatewayModal open={!!gatewayPlan} plan={gatewayPlan} billing={gatewayPlan.billing} price={gatewayPlan.price} paying={cryptoPaying === `${gatewayPlan.id}:${gatewayPlan.billing}`} onClose={() => setGatewayPlan(null)} onCrypto={payWithCrypto} />
      )}

    </div>
  );
}

function PlanBadge({ onClick }: { onClick?: () => void }) {
  const [sub, setSub] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/subscription"); const j = await r.json(); if (alive && r.ok) { setSub(j.subscription); setPlan(j.plan); } } catch {} finally { if (alive) setLoading(false); } };
    load();
    const t = setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, []);
  if (loading) return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 border border-slate-200 bg-white px-3 py-1.5 rounded-full"><span className="w-3 h-3 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" /> Loading</span>;
  if (!plan || !sub) return <button onClick={onClick} className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 px-3.5 py-2 rounded-full hover:bg-amber-100 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all"><Sparkles size={12} /> No plan · Activate →</button>;
  const isLuxe = plan.id === "luxe";
  const isMax = plan.id === "max_plus";
  const bg = isLuxe ? "bg-gradient-to-r from-amber-500 to-pink-600 text-white border-transparent shadow-md shadow-amber-500/20" : isMax ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent shadow-md shadow-violet-500/20" : plan.id === "pro" ? "bg-[#229ED9] text-white border-transparent shadow-md shadow-[#229ED9]/20" : "bg-white text-slate-700 border-slate-200";
  const Icon = isLuxe ? Crown : isMax ? Diamond : plan.id === "pro" ? ZapIcon : Gem;
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-full border hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all ${bg}`}>
      <Icon size={12} /> {plan.name} <span className="opacity-70 font-medium">· {sub.billing === "daily" ? "Daily" : "Monthly"}</span> <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse ml-1" />
    </button>
  );
}

function Shell({ children, onNav }: { children: React.ReactNode, onNav: (v: string) => void }) {
  const { tg, setTg, setView, view, tgAccounts } = useStore() as any;
  const [open, setOpen] = useState(false);
  const accCount = tgAccounts?.length || 0;

  const navGroups: Array<{ label: string; items: Array<[string, any, string]> }> = [
    { label: "Workspace", items: [["dashboard", LayoutDashboard, "Dashboard"], ["plans", Sparkles, "Plans"], ["destinations", Search, "Groups & Joiner"], ["accounts", Users, `Accounts${accCount ? ` · ${accCount}/10` : ""}`]] },
    { label: "Campaigns", items: [["create", Megaphone, "Create Campaign"], ["campaigns", History, "Campaigns"], ["templates", FileText, "Templates"], ["logs", BarChart3, "Delivery Logs"], ["rent", Star, "Rent Accounts"]] },
    { label: "System", items: [["settings", Settings, "Settings"], ["help", HelpCircle, "Help"], ["admin", ShieldCheck, "Admin"]] },
  ];

  const Nav = ({ onItemClick }: { onItemClick?: () => void }) => (
    <div className="space-y-6">
      {navGroups.map(group => (
        <div key={group.label}>
          <div className="text-[10px] font-bold tracking-widest text-slate-400 px-3 mb-2.5">{group.label.toUpperCase()}</div>
          <div className="space-y-1">
            {group.items.map(([k, Icon, label]) => {
              const active = (k as string) === view;
              const isHighlighted = k === "accounts" || k === "rent";
              return (
                <button
                  key={k as string}
                  onClick={() => { setView(k as string); onItemClick?.(); setOpen(false); }}
                  className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium w-full text-left transition-all duration-200 border ${
                    active
                      ? isHighlighted
                        ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-transparent shadow-md shadow-amber-500/20"
                        : "bg-[#229ED9] text-white border-transparent shadow-md shadow-[#229ED9]/20"
                      : isHighlighted
                        ? "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 hover:border-amber-300 hover:text-amber-900 shadow-sm"
                        : "bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900 hover:translate-x-0.5"
                  }`}
                >
                  <Icon size={16} className={`transition-colors shrink-0 ${active ? "text-white" : isHighlighted ? "text-amber-600 group-hover:text-amber-700" : "text-slate-400 group-hover:text-slate-600"}`} />
                  <span className="truncate">{label as string}</span>
                  {isHighlighted && !active && <span className="ml-auto w-2 h-2 bg-amber-500 rounded-full animate-pulse shrink-0" />}
                  {active && <ChevronRight size={12} className="ml-auto opacity-60 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-[264px] bg-white border-r border-slate-200 flex-col sticky top-0 h-screen shrink-0">
        <div className="h-[64px] flex items-center gap-2.5 px-5 font-bold border-b border-slate-200 tracking-tight shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#229ED9] to-[#1B8AC4] flex items-center justify-center text-white shadow-md shadow-[#229ED9]/20"><Send size={15} /></div>
          <span className="text-[15px] tracking-tight">Subplus</span>
          <span className="ml-auto text-[10px] font-bold tracking-widest bg-[#EFF6FF] text-[#229ED9] border border-[#BFDBFE] px-2.5 py-1 rounded-full">PRO</span>
        </div>
        <nav className="p-4 flex-1 overflow-auto"><Nav /></nav>
        <div className="p-3 border-t border-slate-200 bg-slate-50/50">
          {tg ? (
            <ConnectedCard tg={tg} onLogout={() => { setTg(null); localStorage.removeItem("tgm_store"); fetch("/api/telegram/logout",{method:"POST"}).finally(()=>{ setView("landing"); }); }} />
          ) : (
            <button onClick={() => onNav("connect")} className="w-full bg-[#229ED9] text-white rounded-xl py-3 text-sm font-semibold hover:bg-[#1B8AC4] hover:shadow-lg hover:shadow-[#229ED9]/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center justify-center gap-2"><Send size={14} /> Connect Telegram</button>
          )}
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[300px] max-w-[85vw] bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="h-[64px] flex items-center gap-2.5 px-5 font-bold border-b border-slate-200 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-[#229ED9] flex items-center justify-center text-white"><Send size={14} /></div>
              Subplus
              <button onClick={() => setOpen(false)} className="ml-auto w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center hover:bg-slate-200"><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-auto p-4"><Nav onItemClick={() => setOpen(false)} /></div>
            <div className="p-3 border-t border-slate-200">
              {tg ? <ConnectedCard tg={tg} onLogout={() => { setTg(null); localStorage.removeItem("tgm_store"); fetch("/api/telegram/logout",{method:"POST"}).finally(()=>{ setView("landing"); setOpen(false); }); }} /> : <button onClick={() => { onNav("connect"); setOpen(false); }} className="w-full bg-[#229ED9] text-white rounded-xl py-2.5 text-sm font-semibold">Connect Telegram</button>}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-14 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 flex items-center justify-between px-4 md:px-6 sticky top-0 z-10 gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden w-9 h-9 rounded-xl bg-[#229ED9] text-white flex items-center justify-center shrink-0 hover:bg-[#1B8AC4] active:scale-95 transition-all" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
            <div className="md:hidden font-bold flex items-center gap-2 text-sm"><Send size={14} className="text-[#229ED9]" />Subplus</div>
            <span className="hidden md:inline-flex items-center gap-2 text-xs font-semibold text-slate-400 tracking-widest"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> WORKSPACE</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PlanBadge onClick={() => setView("plans")} />
            <button onClick={() => setView("settings")} className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold border border-slate-200 bg-white px-3.5 py-2 rounded-full hover:bg-slate-50 hover:border-slate-300 hover:-translate-y-0.5 active:translate-y-0 transition-all"><Settings size={12} /> Settings</button>
          </div>
        </div>
        <div className="flex-1 p-4 md:p-6 lg:p-7 max-w-[1200px] w-full mx-auto">{children}</div>
      </div>
    </div>
  );
}

function DashboardView({ onNav }: { onNav: (v: string) => void }) {
  const { tg, campaigns, dests } = useStore();
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/stats", { cache: "no-store" }); const j = await r.json(); if (alive) setStats(j); } catch {} };
    load(); const t = setInterval(load, 5000); return () => { alive = false; clearInterval(t); };
  }, [campaigns.length]);
  const statusDot: Record<string, string> = { Completed: "bg-emerald-500", Running: "bg-blue-500 animate-pulse", Paused: "bg-amber-500", Failed: "bg-red-500", Repeating: "bg-violet-500 animate-pulse" };
  const deliveryRate = campaigns.length ? Math.round(campaigns.reduce((a,c)=>a+c.successful,0) / Math.max(1,campaigns.reduce((a,c)=>a+c.destinations.length,0)) * 100) : 0;
  const mine = stats?.mine || null;
  const todaySent = mine ? (mine.todaySent ?? stats.todaySent ?? 0) : (stats ? stats.todaySent : 0);
  const totalSentAll = mine ? mine.totalSent : (stats ? stats.totalSent : campaigns.reduce((a,c)=>a+c.successful,0));
  const totalGroupsAll = mine ? (mine.uniqueGroups ?? mine.totalDestinations ?? 0) : (stats ? stats.uniqueGroups : new Set(campaigns.flatMap(c=>c.destinations||[])).size);
  const todayGroups = mine ? (mine.todayGroups ?? 0) : (stats ? stats.todayGroups : 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Overview of your Telegram workspace</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full w-fit"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> System operational</span>
      </div>

      {/* Hero stats — 3 cards with depth */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="group relative bg-gradient-to-br from-[#229ED9] to-[#1B8AC4] rounded-2xl p-5 text-white overflow-hidden hover:shadow-xl hover:shadow-[#229ED9]/20 hover:-translate-y-1 transition-all duration-300">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:bg-white/15 transition-colors" />
          <div className="absolute -bottom-6 -left-6 w-20 h-20 bg-white/5 rounded-full blur-xl" />
          <div className="relative flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center shadow-sm"><Send size={15} className="text-white" /></div>
            <span className="text-[10px] font-bold tracking-widest bg-white/20 backdrop-blur px-2.5 py-1 rounded-full border border-white/10">TODAY</span>
          </div>
          <div className="relative text-[11px] font-semibold tracking-widest text-white/70 mt-4">MESSAGES TODAY</div>
          <div className="relative text-2xl md:text-3xl font-extrabold mt-1 tracking-tight">{Number(todaySent).toLocaleString()}</div>
          <div className="relative text-xs text-white/60 mt-1">{stats ? `${stats.todayCampaigns} campaigns · ${todayGroups} groups` : "—"}</div>
        </div>
        <div className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-[#BFDBFE] hover:shadow-lg hover:shadow-[#229ED9]/5 hover:-translate-y-1 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center group-hover:bg-[#229ED9] group-hover:border-[#229ED9] transition-colors"><BarChart3 size={15} className="text-[#229ED9] group-hover:text-white transition-colors" /></div>
            <span className="text-[10px] font-bold tracking-widest text-slate-400 border border-slate-200 px-2.5 py-1 rounded-full group-hover:border-[#BFDBFE] group-hover:text-[#229ED9] transition-colors">ALL TIME</span>
          </div>
          <div className="text-[11px] font-semibold tracking-widest text-slate-500 mt-4">TOTAL SENT</div>
          <div className="text-2xl md:text-3xl font-bold mt-1 tracking-tight text-slate-900">{Number(totalSentAll).toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">{mine ? `${mine.totalCampaigns} campaigns` : stats ? `${stats.totalCampaigns} campaigns` : `${campaigns.length} campaigns`}</div>
        </div>
        <div className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-[#BFDBFE] hover:shadow-lg hover:shadow-[#229ED9]/5 hover:-translate-y-1 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center group-hover:bg-[#229ED9] group-hover:border-[#229ED9] transition-colors"><Globe size={15} className="text-[#229ED9] group-hover:text-white transition-colors" /></div>
            <span className="text-[10px] font-bold tracking-widest text-slate-400 border border-slate-200 px-2.5 py-1 rounded-full group-hover:border-[#BFDBFE] group-hover:text-[#229ED9] transition-colors">ALL TIME</span>
          </div>
          <div className="text-[11px] font-semibold tracking-widest text-slate-500 mt-4">TOTAL GROUPS</div>
          <div className="text-2xl md:text-3xl font-bold mt-1 tracking-tight text-slate-900">{Number(totalGroupsAll).toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">{todayGroups ? `${todayGroups} today` : "unique targeted"}</div>
        </div>
      </div>

      {/* Secondary stats — 4 compact cards with hover */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Connected", tg ? `@${tg.username || tg.phone}` : "Not connected", TrendingUp, tg ? "Active" : "Connect needed"],
          ["Destinations", String(dests.filter(d => d.allowed).length), Globe, `${dests.length} total`],
          ["Campaigns", String(campaigns.length), Megaphone, `${campaigns.filter(c=>c.status==="Running"||c.status==="Repeating").length} active`],
          ["Delivery", `${deliveryRate}%`, Send, `${campaigns.reduce((a,c)=>a+c.successful,0)} sent`],
        ].map(([k, v, Icon, sub]: any) => (
          <div key={k as string} className="group bg-white border border-slate-200 rounded-2xl p-4 hover:border-[#BFDBFE] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 group-hover:bg-[#EFF6FF] group-hover:border-[#BFDBFE] transition-colors"><Icon size={12} className="text-slate-500 group-hover:text-[#229ED9] transition-colors" /></div>
              <span className="text-[11px] font-semibold tracking-widest text-slate-400 truncate">{(k as string).toUpperCase()}</span>
            </div>
            <div className="text-lg font-bold mt-3 tracking-tight text-slate-900 truncate">{v as string}</div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">{sub as string}</div>
          </div>
        ))}
      </div>

      {/* Recent campaigns */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 md:px-5 py-4 flex items-center justify-between gap-3 border-b border-slate-100">
          <h2 className="font-semibold text-sm text-slate-900">Recent Campaigns</h2>
          <button onClick={() => onNav("campaigns")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 border border-slate-200 bg-white px-3.5 py-2 rounded-full hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700 hover:-translate-y-0.5 active:translate-y-0 transition-all shrink-0">View all <ChevronRight size={12} /></button>
        </div>
        {campaigns.length === 0 ? (
          <div className="p-10 text-center animate-slide-up">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto"><Megaphone size={20} className="text-slate-400" /></div>
            <p className="text-sm font-semibold text-slate-700 mt-4">No campaigns yet</p>
            <p className="text-xs text-slate-400 mt-1.5">Create your first campaign to get started.</p>
            <button onClick={() => onNav("create")} className="mt-5 inline-flex items-center gap-2 bg-[#229ED9] text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-[#1B8AC4] hover:shadow-lg hover:shadow-[#229ED9]/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all"><Megaphone size={14} /> Create Campaign</button>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {campaigns.slice(0, 5).map((c: any) => (
                <div key={c.id} className="p-4 flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot[c.status]||"bg-slate-300"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{c.destinations.length} destinations · {c.createdAt}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold border ${c.status === "Completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : c.status === "Repeating" ? "bg-violet-50 text-violet-700 border-violet-200" : c.status === "Running" ? "bg-[#EFF6FF] text-blue-700 border-[#BFDBFE]" : c.status === "Paused" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-50 border-slate-200"}`}>{c.status}</span>
                    <div className="text-xs font-semibold text-slate-600 mt-1">{c.successful}/{c.destinations.length}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs font-bold tracking-widest"><tr><th className="text-left px-5 py-3">CAMPAIGN</th><th className="px-4 py-3 text-center">DEST.</th><th className="px-4 py-3">STATUS</th><th className="px-4 py-3">CREATED</th><th className="px-4 py-3 text-right">RESULT</th></tr></thead>
                <tbody>{campaigns.slice(0, 5).map((c: any) => <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/50"><td className="px-5 py-3.5"><div className="font-semibold text-slate-900 flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${statusDot[c.status]||"bg-slate-300"}`} />{c.name}</div><div className="text-xs text-slate-400 mt-0.5">{c.destinations.length} destinations</div></td><td className="px-4 text-center"><span className="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full text-xs font-semibold">{c.destinations.length}</span></td><td className="px-4"><span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${c.status === "Completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : c.status === "Repeating" ? "bg-violet-50 text-violet-700 border-violet-200" : c.status === "Running" ? "bg-[#EFF6FF] text-blue-700 border-[#BFDBFE]" : c.status === "Paused" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-slate-50 border-slate-200"}`}>{c.status}</span></td><td className="px-4 text-slate-500 text-xs">{c.createdAt}</td><td className="px-5 text-right"><span className="font-bold text-slate-900">{c.successful}/{c.destinations.length}</span><span className="text-xs text-slate-400 ml-1.5">{Math.round(c.successful/Math.max(1,c.destinations.length)*100)}%</span></td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DestinationsView() {
  const { dests, tg, activeTgId } = useStore() as any;
  const [real, setReal] = useState<any[] | null>(null);
  const [q, setQ] = useState(""), [loading, setLoading] = useState(false), [err, setErr] = useState("");
  const [pf, setPf] = useState("All");
  const [tab, setTab] = useState<"list" | "join">("list");
  useEffect(() => { setReal(null); }, [activeTgId]);
  // join state
  const [joinLinks, setJoinLinks] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinResults, setJoinResults] = useState<any[] | null>(null);
  const joinList = [...new Set(joinLinks.split("\n").map(s => s.trim()).filter(Boolean))];

  const groupsOnly = (arr: any[]) => arr.filter((d: any) => d.type === "Group");
  const list = groupsOnly(real ?? dests);
  let filtered = list.filter((d: any) => d.title.toLowerCase().includes(q.toLowerCase()));
  if (pf !== "All") filtered = filtered.filter((d: any) => (d.privacy || "Private") === pf);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const refresh = async () => {
    setLoading(true); setErr("");
    try { const r = await fetch("/api/telegram/dialogs"); const j = await r.json(); if (!r.ok) throw new Error(j.error); setReal(groupsOnly(j.dialogs || [])); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  const doLeave = async (d: any) => {
    if (!confirm(`Leave "${d.title}"? You will need an invite link to rejoin private groups.`)) return;
    setLeavingId(d.id); setErr("");
    try {
      const r = await fetch("/api/telegram/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id, title: d.title }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed to leave");
      // remove from local list immediately
      setReal(prev => prev ? prev.filter((x: any) => String(x.id) !== String(d.id)) : prev);
      // also update dests via refresh
      await refresh();
    } catch (e: any) { setErr(e.message); } finally { setLeavingId(null); }
  };
  const doJoin = async () => {
    if (!joinList.length) return alert("Paste at least one group link");
    setJoining(true); setErr(""); setJoinResults([]);
    try {
      const CHUNK = 50;
      const all: any[] = [];
      for (let i = 0; i < joinList.length; i += CHUNK) {
        const chunk = joinList.slice(i, i + CHUNK);
        const r = await fetch("/api/telegram/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links: chunk }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error);
        all.push(...(j.results || []));
        setJoinResults([...all]);
        if (j.results?.some((x: any) => x.status === "RateLimited")) await new Promise(res => setTimeout(res, 2000));
      }
    } catch (e: any) { setErr(e.message); } finally { setJoining(false); }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-start">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Groups & Joiner</h1>
          <p className="text-sm text-slate-500 mt-1">{tab === "list" ? <>{real ? <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-semibold"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> Live — {tg ? `@${tg.username}` : ""}</span> : <span className="inline-flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full text-xs font-semibold">↻ Hit Refresh to load groups</span>} <span className="text-xs text-slate-400 ml-1">— active account only</span></> : "Join public & private groups via invite links."}</p>
        </div>
        {tab === "list" && <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-sm hover:bg-[#1B8AC4] disabled:opacity-50 shrink-0"><Search size={14} />{loading ? "Loading..." : "Refresh"}</button>}
      </div>
      <div className="inline-flex bg-slate-100 rounded-full p-1 gap-1 mt-4">
        <button onClick={() => setTab("list")} className={`px-5 py-2 rounded-full text-xs font-bold transition-all duration-200 ${tab === "list" ? "bg-[#229ED9] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>My Groups</button>
        <button onClick={() => setTab("join")} className={`px-5 py-2 rounded-full text-xs font-bold transition-all duration-200 ${tab === "join" ? "bg-[#229ED9] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Join Groups</button>
      </div>
      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mt-3">{err}</div>}
      {tab === "join" ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 mt-4 shadow-sm space-y-3">
          <div className="text-xs font-bold tracking-widest text-[#64748B]">GROUP LINKS — one per line (no limit — 1000+ supported)</div>
          <p className="text-xs text-[#64748B]">Supports private (<code className="bg-[#F1F5F9] px-1 rounded">t.me/+AbCdEf…</code>, <code className="bg-[#F1F5F9] px-1 rounded">t.me/joinchat/…</code>) & public (<code className="bg-[#F1F5F9] px-1 rounded">t.me/username</code>, <code className="bg-[#F1F5F9] px-1 rounded">@username</code>, <code className="bg-[#F1F5F9] px-1 rounded">https://t.me/…</code>). Duplicates removed. Large batches run with progress — Telegram may rate-limit; failed ones can be retried.</p>
          <textarea value={joinLinks} onChange={e => setJoinLinks(e.target.value)} placeholder={"https://t.me/+AbCdEfGhIjKlMnOp\nhttps://t.me/joinchat/AAAAAE...\nt.me/mypublicgroup\n@anothergroup"} rows={12} className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 text-sm font-mono focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none" />
          <div className="flex gap-2 items-center text-xs"><span className={`font-bold px-2.5 py-1 rounded-full border ${joinList.length ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]"}`}>{joinList.length.toLocaleString()} links</span><span className="text-[#94A3B8]">No limit</span><button onClick={() => { setJoinLinks(""); setJoinResults(null); }} className="ml-auto border border-[#E2E8F0] bg-white px-3 py-1.5 rounded-full font-semibold">Clear</button></div>
          {joining && joinResults && <div className="text-xs font-semibold text-[#229ED9]">{joinResults.length} / {joinList.length} processed…</div>}
          <button onClick={doJoin} disabled={joining || !joinList.length} className="bg-[#229ED9] text-white px-7 py-3 rounded-full text-sm font-bold shadow disabled:opacity-50">{joining ? `Joining ${joinResults ? `${joinResults.length}/${joinList.length}` : "..."}` : `Join ${joinList.length ? joinList.length.toLocaleString() : ""} Groups`}</button>
          {joinResults && <div className="space-y-1.5 pt-2">{joinResults.map((r: any, i: number) => <div key={i} className={`flex justify-between items-center rounded-xl px-3.5 py-2.5 border text-sm ${r.status === "Joined" || r.status === "Already member" ? "bg-emerald-50 border-emerald-200" : r.status === "RateLimited" ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}><span className="font-medium truncate mr-2">{r.link}</span><span className={`text-xs font-bold shrink-0 ${r.status === "Joined" || r.status === "Already member" ? "text-emerald-700" : r.status === "RateLimited" ? "text-amber-700" : "text-red-600"}`}>{r.status}{r.error ? ` — ${r.error}` : ""}</span></div>)}<button onClick={refresh} className="mt-2 text-xs font-bold text-[#229ED9] border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-2 rounded-full">Refresh My Groups →</button></div>}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mt-4">
            <div className="inline-flex bg-slate-100 rounded-full p-1 gap-1">
              {["All", "Private", "Public"].map(p => <button key={p} onClick={() => setPf(p)} className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-200 ${pf === p ? "bg-[#229ED9] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{p}</button>)}
            </div>
            <span className="text-xs font-medium text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">{filtered.length} shown</span>
          </div>
          <div className="relative mt-3"><Search size={16} className="absolute left-3.5 top-3.5 text-[#94A3B8]" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search groups & channels" className="w-full border border-[#E2E8F0] rounded-xl pl-10 pr-3 py-3 text-sm bg-white focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none shadow-sm" /></div>
          <div className="bg-white border border-[#E2E8F0] rounded-[20px] mt-4 overflow-hidden shadow-sm overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[#F8FAFC] text-xs font-semibold text-[#64748B]"><tr><th className="text-left px-4 py-3">Group / Channel</th><th className="px-4">Type</th><th className="px-4">Privacy</th><th className="px-4">Members</th><th className="px-4">Permission</th><th className="px-4">Last Used</th><th className="px-4 text-right">Action</th></tr></thead>
            <tbody>{filtered.map((d: any) => <tr key={d.id} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60"><td className="px-4 py-3"><div className="font-semibold">{d.title}</div>{d.username && <div className="text-xs text-[#94A3B8]">@{d.username}</div>}</td><td className="px-4"><span className="bg-[#F1F5F9] px-2 py-1 rounded-full text-xs font-medium">{d.type}</span></td><td className="px-4"><span className={`px-2 py-1 rounded-full text-xs font-semibold border ${d.privacy === "Public" ? "bg-[#EFF6FF] text-blue-700 border-[#BFDBFE]" : "bg-violet-50 text-violet-700 border-violet-200"}`}>{d.privacy || "Private"}</span></td><td className="px-4">{d.members?.toLocaleString?.() ?? d.members}</td><td className="px-4">{d.allowed ? <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-xs font-semibold">✓ Allowed</span> : <span className="text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full text-xs font-semibold">✕ Unavailable</span>}</td><td className="px-4 text-[#64748B]">{d.lastUsed}</td><td className="px-4 text-right"><button onClick={() => doLeave(d)} disabled={leavingId === d.id} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-full hover:bg-red-50 disabled:opacity-50">{leavingId === d.id ? "Leaving…" : "Leave"}</button></td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

function CreateCampaign() {
  const { dests, tg, addCampaign, refreshDests, destsLoading, setView, templates, activeTgId, tgAccounts, setActiveTgId, setTg } = useStore() as any;
  const [step, setStep] = useState(1);
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState<any>(null);
  const [scheduleMode, setScheduleMode] = useState<"now" | "repeat">("now");
  const [delayMins, setDelayMins] = useState(15);
  const [scheduledInfo, setScheduledInfo] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const intervalRef = (globalThis as any).__tgm_intervals || ((globalThis as any).__tgm_intervals = new Map());

  const onImage = (f: File | null) => {
    setImage(f);
    if (f) { const r = new FileReader(); r.onload = () => setImagePreview(r.result as string); r.readAsDataURL(f); }
    else setImagePreview(null);
  };
  const eligible = dests.filter((d: any) => d.allowed);
  const [hideRestricted, setHideRestricted] = useState(false);
  const visibleDests = hideRestricted ? dests.filter((d: any) => d.allowed) : dests;
  const restrictedCount = dests.length - eligible.length;
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const { updateCampaign, campaigns } = useStore() as any;
  const [planInfo, setPlanInfo] = useState<any>(null);
  useEffect(() => { fetch("/api/subscription").then(r => r.json()).then(j => { if (j.plan) setPlanInfo(j); }).catch(()=>{}); }, []);
  const planLimits = planInfo?.plan ? { maxGroups: planInfo.plan.groupsPerCampaign, maxCamps: planInfo.plan.campaignsPerDay, minRepeat: planInfo.plan.minRepeatMins, name: planInfo.plan.name } : null;
  const groupsLimit = planLimits?.maxGroups ?? 10;
  const campsToday = planInfo?.usage?.campaignsToday ?? 0;
  const campsLimit = planInfo?.usage?.campaignsLimit;
  const minRepeat = planLimits?.minRepeat ?? 15;

  const exportRunning = () => {
    if (!running?.logs?.length) return alert("No data yet");
    const headers = ["Destination", "Status", "Error"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.map(esc).join(","), ...running.logs.map((l: any) => [l.text, l.status, l.error || ""].map(esc).join(","))].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `campaign-${(running.campaignName||"export")}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  if (running) {
    const total = running.total, done = running.done, pct = Math.round(done / total * 100);
    const completed = done >= total;
    return (
      <div>
        <div className="flex justify-between items-center"><h1 className="text-2xl font-extrabold tracking-tight">{completed ? "Campaign Completed ✓" : "Campaign Running"}</h1></div>
        <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-6 mt-4 shadow-sm">
          <div className="flex justify-between text-sm font-medium mb-2"><span>{done} / {total} destinations • Sent {done}</span><span className="text-[#229ED9] font-bold">{pct}%</span></div>
          <div className="h-2.5 bg-[#E2E8F0] rounded-full overflow-hidden"><div className="h-2.5 bg-[#229ED9] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
          <div className="grid grid-cols-4 gap-3 mt-5 text-center">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3"><div className="text-[11px] font-bold tracking-widest text-emerald-700">SUCCESSFUL</div><div className="font-extrabold text-emerald-700 text-lg">{running.success}</div><div className="text-[10px] text-emerald-600 font-semibold">Sent</div></div>
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-3"><div className="text-[11px] font-bold tracking-widest text-[#64748B]">PENDING</div><div className="font-extrabold text-lg">{total - done}</div><div className="text-[10px] text-[#64748B]">Remaining</div></div>
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3"><div className="text-[11px] font-bold tracking-widest text-red-700">REJECTED</div><div className="font-extrabold text-red-600 text-lg">{running.fail - running.limited}</div><div className="text-[10px] text-red-500 font-semibold">Failed</div></div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3"><div className="text-[11px] font-bold tracking-widest text-amber-700">LIMITED</div><div className="font-extrabold text-amber-600 text-lg">{running.limited}</div><div className="text-[10px] text-amber-600">Flood wait</div></div>
          </div>
          <div className="mt-4 space-y-1.5 text-sm max-h-48 overflow-auto">{running.logs.map((l: any, i: number) => <div key={i} className="flex justify-between bg-[#F8FAFC] rounded-xl px-3.5 py-2.5 border border-[#E2E8F0]"><span className="font-medium">{l.text}</span><span className={l.ok ? "text-emerald-600 font-semibold" : l.status==="RateLimited" ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"}>{l.status}</span></div>)}</div>
          <div className="flex flex-wrap gap-2 mt-5">
            {!completed ? <>
              <button onClick={() => { if(running.campaignId) updateCampaign(running.campaignId,{status:"Paused"}); setRunning(null); }} className="border border-[#E2E8F0] bg-white px-5 py-2.5 rounded-full text-sm font-semibold flex items-center gap-1.5"><Pause size={14} />Pause</button>
              <button onClick={() => { if(running.campaignId) updateCampaign(running.campaignId,{status:"Failed"}); setRunning(null); }} className="bg-red-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold flex items-center gap-1.5"><X size={14} />Cancel</button>
            </> : <>
              <button onClick={exportRunning} className="bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-sm font-semibold flex items-center gap-1.5"><Download size={14}/>Download / Export CSV</button>
              <button onClick={()=>{setRunning(null); setView("logs");}} className="border border-[#E2E8F0] bg-white px-5 py-2.5 rounded-full text-sm font-semibold">View in History →</button>
              <button onClick={()=>{setRunning(null); setSel([]); setMsg(""); setName(""); setImage(null); setImagePreview(null); setStep(1);}} className="border border-[#E2E8F0] bg-white px-5 py-2.5 rounded-full text-sm font-semibold">New Campaign</button>
            </>}
            {!completed && <button onClick={exportRunning} className="ml-auto border border-[#E2E8F0] bg-white px-4 py-2.5 rounded-full text-sm font-semibold flex items-center gap-1.5"><Download size={14}/>Export</button>}
          </div>
        </div>
      </div>
    );
  }

  const doSend = async (finalDests: string[], campName: string, id: string) => {
    const c = { id, name: campName, destinations: finalDests, message: msg, status: "Running" as const, successful: 0, failed: 0, createdAt: new Date().toLocaleString(), logs: [] as any[], accountId: activeTgId } as any;
    addCampaign(c);
    setRunning({ campaignId: id, campaignName: campName, total: finalDests.length, done: 0, success: 0, fail: 0, limited: 0, logs: [] });
    const finalize = (logs:any[])=>{
      const success = logs.filter((l:any)=>l.ok).length, fail = logs.length - success, limited = logs.filter((l:any)=>l.status==="RateLimited").length;
      setRunning({ campaignId: id, campaignName: campName, total: finalDests.length, done: logs.length, success, fail, limited, logs });
      updateCampaign(id,{ status: fail>0 && success===0 ? "Failed" : "Completed", successful: success, failed: fail, logs: logs.map((l:any,idx:number)=>({dest: finalDests[idx], status: l.status, time: new Date().toLocaleString(), error: l.error||""})) });
    };
    let r: Response;
    if (image) {
      const fd = new FormData();
      fd.set("destinations", JSON.stringify(finalDests));
      fd.set("message", msg);
      fd.set("image", image);
      if (activeTgId) fd.set("accountId", String(activeTgId));
      // store image as base64 for scheduled retry (file ref lost after delay) — save preview
      (c as any)._imagePreview = imagePreview;
      r = await fetch("/api/telegram/send", { method: "POST", body: fd });
    } else {
      r = await fetch("/api/telegram/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinations: finalDests, message: msg, accountId: activeTgId }) });
    }
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    const logs = j.results.map((x: any) => ({ text: dests.find((d:any) => d.id === x.dest)?.title || x.dest, status: x.status, ok: x.status === "Sent", error: x.error }));
    finalize(logs);
  };

  const startCampaign = async () => {
    if (sending) return;
    setSending(true);
    if (!planLimits) { setSending(false); alert("No active plan — redeem a key in Plans first."); setView("plans"); return; }
    if (campsLimit && campsToday >= campsLimit) { setSending(false); alert(`${planLimits.name} allows ${campsLimit} campaigns per day — you have used ${campsToday} today.`); return; }
    if (sel.length > groupsLimit) { setSending(false); alert(`Max ${groupsLimit} groups per campaign on ${planLimits.name}. Remove ${sel.length - groupsLimit} or upgrade.`); return; }
    if (scheduleMode === "repeat" && delayMins < minRepeat) { setSending(false); alert(`${planLimits.name} requires repeat ≥ ${minRepeat} min (you set ${delayMins} min).`); return; }
    if (!confirm) { setSending(false); return alert("Please confirm authorization checkbox"); }
    if (!msg.trim() && !image) { setSending(false); return alert("Add text or an image"); }
    if (!sel.length) { setSending(false); return alert("Select at least one destination"); }
    try {
    const campName = name || "Untitled Campaign";
    const id = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9));

    if (scheduleMode === "repeat") {
      const intervalId = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
      const at = new Date().toLocaleString();
      // lock to the account that was active when campaign was created — server will always send from this account
      addCampaign({ id, name: campName, destinations: [...sel], message: msg, imagePreview, status: "Repeating" as any, successful: 0, failed: 0, createdAt: at, logs: [], scheduledAt: at, delayMins, repeatIntervalId: intervalId, repeatEveryMins: delayMins, accountId: activeTgId } as any);
      setScheduledInfo({ mins: delayMins, at, intervalId, repeating: true });
      setView("campaigns");
      // send immediately from the locked account — future repeats are handled server-side even if browser is closed
      const sendNow = async () => {
        let r: Response;
        if (image) { const fd=new FormData(); fd.set("destinations", JSON.stringify([...sel])); fd.set("message", msg); fd.set("image", image); if (activeTgId) fd.set("accountId", String(activeTgId)); r=await fetch("/api/telegram/send",{method:"POST",body:fd}); }
        else r=await fetch("/api/telegram/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({destinations:[...sel],message:msg, accountId: activeTgId})});
        const j=await r.json(); if(!r.ok) throw new Error(j.error);
        const ok=j.results?.filter((x:any)=>x.status==="Sent").length??0;
        const failed=(j.results?.length??0)-ok;
        const firstLogs=(j.results||[]).map((x:any)=>({ dest: x.dest, status: x.status, time: x.time || new Date().toISOString(), error: x.error || "" }));
        const nowIso=new Date().toISOString();
        const nextIso=new Date(Date.now()+Number(delayMins)*60*1000).toISOString();
        updateCampaign(id,{ successful: ok, failed, logs: firstLogs, lastRunAt: nowIso, nextRunAt: nextIso } as any);
      };
      try { await sendNow(); } catch(e:any){ /* keep repeating even if first send fails — server tick will retry */ }
      setSending(false);
      return;
    }
    try { await doSend([...sel], campName, id); } catch (e:any) { alert(e.message); setRunning(null); }
    } finally { setSending(false); }
  };

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Create Campaign</h1>
      <div className="flex gap-2 mt-4">{[1, 2, 3].map(n => <div key={n} className={`flex-1 h-2 rounded-full ${n <= step ? "bg-[#229ED9]" : "bg-[#E2E8F0]"}`} />)}</div>
      <div className="text-xs font-semibold tracking-widest text-[#64748B] mt-2">STEP {step} OF 3 — {["Destinations", "Message", "Review & Send"][step - 1]}</div>

      {step === 1 && <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 mt-4 shadow-sm">
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${tg?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{tg?.connected ? "● Live from Telegram" : "○ Mock data — connect Telegram to load real"}</span>
          <button onClick={refreshDests} disabled={destsLoading} className="text-xs font-semibold border border-[#E2E8F0] bg-white px-4 py-2 rounded-full hover:bg-[#F8FAFC] disabled:opacity-50">{destsLoading ? "Loading..." : "Refresh"}</button>
          <span className="text-xs text-[#64748B] ml-auto">{eligible.length} eligible</span>
        </div>
        {planLimits && <div className="mb-3 flex flex-wrap gap-2 text-xs"><span className="bg-[#229ED9] text-white px-3 py-1 rounded-full font-bold">{planLimits.name} · {groupsLimit} groups/campaign</span><span className={`px-3 py-1 rounded-full font-semibold border ${campsLimit && campsToday >= campsLimit ? "bg-red-50 text-red-700 border-red-200" : "bg-white border-slate-200"}`}>Campaigns today: {campsToday}{campsLimit ? ` / ${campsLimit}` : " / Unlimited"}</span><span className="bg-white border border-slate-200 px-3 py-1 rounded-full">Repeat min {minRepeat}m</span></div>}
        {!planLimits && <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2">No active plan — redeem a key in <button onClick={() => setView("plans")} className="underline font-bold">Plans</button> to unlock sending.</div>}
        <div className="flex flex-wrap gap-2 mb-4 items-center"><button onClick={() => {
          if (eligible.length > groupsLimit) { alert(`${planLimits?.name || "Elite"} allows max ${groupsLimit} groups per campaign — select up to ${groupsLimit}. Upgrade in Plans for more.`); setSel(eligible.slice(0, groupsLimit).map((d:any) => d.id)); return; }
          setSel(eligible.map((d:any) => d.id));
        }} className="text-xs font-semibold border border-[#E2E8F0] bg-white px-4 py-2 rounded-full hover:bg-[#F8FAFC]">Select All Eligible</button><button onClick={() => setSel([])} className="text-xs font-semibold border border-[#E2E8F0] bg-white px-4 py-2 rounded-full hover:bg-[#F8FAFC]">Clear</button><span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${sel.length > groupsLimit ? "bg-red-50 text-red-700 border-red-200" : "text-[#229ED9] bg-[#EFF6FF] border-[#BFDBFE]"}`}>{sel.length} / {groupsLimit} selected</span><span className="text-xs text-[#64748B] ml-auto">{dests.length} total · <span className="text-emerald-600 font-bold">{eligible.length} allowed</span> · <span className="text-red-600 font-bold">{restrictedCount} restricted</span></span></div>
        {sel.length > groupsLimit && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">You selected {sel.length} groups — {planLimits?.name || "your plan"} allows max {groupsLimit} per campaign. Remove {sel.length - groupsLimit} or <button onClick={() => setView("plans")} className="underline font-bold">upgrade</button>.</div>}
        {restrictedCount > 0 && <label className="flex items-center gap-2 mb-3 cursor-pointer select-none"><input type="checkbox" checked={hideRestricted} onChange={e => setHideRestricted(e.target.checked)} className="accent-[#134E4A] w-3.5 h-3.5" /><span className="text-xs font-semibold text-[#475569]">Hide restricted groups ({restrictedCount})</span><span className="text-[11px] text-[#94A3B8]">{hideRestricted ? "— showing only sendable" : "— uncheck to review"}</span></label>}
        <div className="space-y-2 max-h-80 overflow-auto pr-1">{dests.length === 0 ? <div className="text-center py-8 text-sm text-[#94A3B8]">No groups — join groups or refresh.</div> : visibleDests.length === 0 ? <div className="text-center py-8 text-sm text-[#94A3B8]">All groups are restricted — nothing to show with filter on.</div> : visibleDests.map((d:any) => d.allowed ? (
          <label key={d.id} className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${sel.includes(d.id) ? "bg-[#EFF6FF] border-[#229ED9]/30 ring-1 ring-[#229ED9]/20" : "border-[#E2E8F0] hover:bg-[#F8FAFC]"}`}>
            <input type="checkbox" checked={sel.includes(d.id)} onChange={() => toggle(d.id)} className="accent-[#229ED9] w-4 h-4 shrink-0" />
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Allowed" />
            <span className="text-sm font-semibold flex-1 truncate">{d.title}</span>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">✓ Allowed</span>
            <span className="text-xs text-[#64748B] bg-white border border-[#E2E8F0] px-2 py-0.5 rounded-full shrink-0 hidden sm:inline">{d.type} · {d.members.toLocaleString()}</span>
          </label>
        ) : (
          <div key={d.id} className="flex items-center gap-3 border-2 border-red-200 bg-[#FEF2F2] rounded-xl px-4 py-3">
            <input type="checkbox" disabled className="w-4 h-4 shrink-0 opacity-40" />
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" title="Restricted" />
            <span className="text-sm font-semibold flex-1 truncate text-red-900">{d.title}</span>
            <span className="text-xs font-bold text-white bg-red-500 px-2.5 py-0.5 rounded-full shrink-0">✕ Restricted — can&apos;t send</span>
            <span className="text-xs text-red-600 bg-white border border-red-200 px-2 py-0.5 rounded-full shrink-0 hidden sm:inline">{d.type} · {d.members.toLocaleString()}</span>
          </div>
        ))}
        </div>
        <div className="flex gap-2 mt-3 text-[11px]"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Allowed</span><span className="flex items-center gap-1.5 ml-3"><span className="w-2 h-2 rounded-full bg-red-500" /> Restricted — no permission to post</span></div>
        <button onClick={() => {
          if (!planLimits) { alert("No active plan — redeem a key in Plans first."); setView("plans"); return; }
          if (campsLimit && campsToday >= campsLimit) { alert(`${planLimits.name} allows ${campsLimit} campaigns per day — you have used ${campsToday} today.`); return; }
          if (sel.length > groupsLimit) { alert(`Max ${groupsLimit} groups per campaign on ${planLimits.name}. Remove ${sel.length - groupsLimit} or upgrade.`); return; }
          if (!sel.length) { alert("Select at least one destination"); return; }
          setStep(2);
        }} className="mt-5 bg-[#229ED9] text-white px-7 py-3 rounded-full text-sm font-semibold shadow-lg">Continue →</button>
      </div>}

      {step === 2 && <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 mt-4 shadow-sm space-y-4">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Campaign name (e.g. Weekend Offer)" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none" />

        {templates?.length > 0 && <div>
          <div className="text-xs font-bold tracking-widest text-[#64748B] mb-2">USE SAVED TEMPLATE (optional)</div>
          <select value="" onChange={e => {
            const t = templates.find((x: any) => x.id === e.target.value);
            if (!t) return;
            setMsg(t.message || "");
            if (t.image) {
              setImagePreview(t.image);
              try {
                const arr = t.image.split(","), mime = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
                const bstr = atob(arr[1]); const u8 = new Uint8Array(bstr.length);
                for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
                setImage(new File([u8], "template-image.jpg", { type: mime }));
              } catch {}
            }
          }} className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 text-sm bg-white outline-none focus:border-[#229ED9]">
            <option value="">— Select a template to fill —</option>
            {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="text-[11px] text-[#94A3B8] mt-1">Selecting a template fills message + image (you can still edit).</p>
        </div>}

        <div>
          <div className="text-xs font-bold tracking-widest text-[#64748B] mb-2">MESSAGE TEXT</div>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Write your message... (empty allowed if image attached)" maxLength={4096} rows={5} className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none" />
          <div className="text-xs font-medium text-[#64748B] mt-1">{msg.length} / 4096</div>
        </div>

        <div>
          <div className="text-xs font-bold tracking-widest text-[#64748B] mb-2">IMAGE (optional)</div>
          <label className="flex items-center gap-3 border border-dashed border-[#CBD5E1] rounded-xl px-4 py-3 cursor-pointer hover:bg-[#F8FAFC]">
            <input type="file" accept="image/*" className="hidden" onChange={e => onImage(e.target.files?.[0] || null)} />
            <span className="text-sm font-semibold text-[#229ED9]">{image ? "Change image" : "Upload image"}</span>
            <span className="text-xs text-[#64748B]">{image ? image.name : "JPG/PNG/WebP, max 8MB"}</span>
            {image && <button type="button" onClick={ev => { ev.preventDefault(); onImage(null); }} className="ml-auto text-xs font-bold text-red-600">Remove</button>}
          </label>
          {imagePreview && <img src={imagePreview} alt="preview" className="mt-3 rounded-xl border border-[#E2E8F0] max-h-52 object-contain" />}
        </div>

        <div className="flex gap-2"><button onClick={() => setStep(1)} className="border border-[#E2E8F0] bg-white px-5 py-2.5 rounded-full text-sm font-semibold">Back</button><button onClick={() => (msg.trim() || image) ? setStep(3) : alert("Add text or an image")} className="bg-[#229ED9] text-white px-7 py-2.5 rounded-full text-sm font-semibold">Preview & Review →</button></div>
      </div>}

      {step === 3 && <div className="space-y-4 mt-4">
        <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 shadow-sm">
          <div className="text-xs font-bold tracking-widest text-[#64748B]">TELEGRAM PREVIEW</div>
          <div className="mt-3 bg-gradient-to-br from-[#EFF6FF] to-[#F0F9FF] rounded-[20px] p-4 max-w-sm border border-[#BFDBFE]"><div className="flex gap-2.5 items-center"><div className="w-9 h-9 rounded-full bg-[#229ED9] text-white flex items-center justify-center text-xs font-bold shadow">{(tg?.username?.[0] || tg?.displayName?.[0] || tg?.phone?.[0] || "T").toUpperCase()}</div><div className="text-sm font-bold">{tg ? (tg.username ? `@${tg.username}` : tg.displayName || tg.phone || "Your Telegram") : "Your Telegram"}</div><span className="text-xs font-semibold text-[#64748B] ml-auto bg-white px-2 py-0.5 rounded-full border">Preview Only</span></div>
            {imagePreview && <img src={imagePreview} alt="preview" className="mt-3 rounded-2xl border border-[#E2E8F0] w-full object-contain bg-white" />}
            <div className="bg-white rounded-2xl p-3.5 mt-3 text-sm whitespace-pre-wrap shadow-sm border border-[#E2E8F0]">{msg || (image ? "(image with no caption)" : "Your message will appear here")}</div>
          </div>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 shadow-sm">
          <h3 className="font-bold">Campaign Summary</h3>
          <div className="text-sm mt-3 space-y-1.5 text-[#475569]">
            <div className="flex flex-wrap gap-2 items-center">
              <span>Sender:</span>
              <select value={activeTgId || ""} onChange={e => {
                const id = e.target.value;
                const acc = (tgAccounts || []).find((a: any) => a.id === id);
                if (acc) { setActiveTgId(id); setTg({ username: acc.username, phone: acc.phone, connected: true, displayName: acc.displayName, firstName: acc.firstName }); fetch("/api/telegram/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: id }) }).catch(()=>{}); }
              }} className="border border-[#E2E8F0] rounded-full px-3 py-1.5 text-xs font-semibold bg-white max-w-[260px]">
                {(tgAccounts || []).map((a: any) => <option key={a.id} value={a.id}>{a.displayName || a.username || a.phone} {a.username ? `@${a.username}` : ""} {(a as any).isRental ? "· Rented" : ""} {a.id === activeTgId ? "· Active" : ""}</option>)}
                {!(tgAccounts || []).length && <option value="">No accounts</option>}
              </select>
              <button onClick={() => setView("rent")} className="text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-600 text-white px-3 py-1.5 rounded-full">⭐ Rent one</button>
            </div>
            <div>Destinations: <span className="text-slate-900 font-bold">{sel.length}</span></div><div>Message: <span className="text-slate-900 font-medium">{name || "Untitled"}</span></div>
            {(tgAccounts || []).find((a: any) => a.id === activeTgId && (a as any).isRental) && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2">⭐ Using rented sender — expires {new Date((tgAccounts.find((a:any)=>a.id===activeTgId) as any).rentalExpiresAt).toLocaleString()}</div>}
          </div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4 mt-5">
            <div className="text-xs font-bold tracking-widest text-[#64748B] mb-3">⏱ SEND TIMING</div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setScheduleMode("now")} className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${scheduleMode === "now" ? "bg-[#229ED9] text-white border-slate-900" : "bg-white border-[#E2E8F0] hover:bg-[#F8FAFC]"}`}>⚡ Send once</button>
              <button onClick={() => setScheduleMode("repeat")} className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${scheduleMode === "repeat" ? "bg-[#229ED9] text-white border-slate-900" : "bg-white border-[#E2E8F0] hover:bg-[#F8FAFC]"}`}>🔁 Repeat every…</button>
            </div>
            {scheduleMode === "repeat" && <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-semibold text-[#475569]">Every</span>
              {[1, 15, 60, 240].filter(m => m >= minRepeat).map(m => <button key={m} onClick={() => setDelayMins(m)} className={`px-4 py-2 rounded-full text-xs font-bold border ${delayMins === m ? "bg-[#EFF6FF] border-[#229ED9] text-[#229ED9]" : "bg-white border-[#E2E8F0]"}`}>{m < 60 ? `${m} min` : `${m/60} hr${m>60?"s":""}`}</button>)}
              <span className="flex items-center gap-1 text-xs border border-[#E2E8F0] rounded-full px-3 py-1.5 bg-white"><input type="number" min={minRepeat} value={delayMins} onChange={e => setDelayMins(Math.max(minRepeat, parseInt(e.target.value)||minRepeat))} className="w-12 outline-none font-bold text-center" /> min</span>
              <span className="text-[11px] text-[#94A3B8]">— min {minRepeat}m on {planLimits?.name || "Elite"} · sends immediately, then every {delayMins < 60 ? `${delayMins}m` : `${Math.floor(delayMins/60)}h${delayMins%60?` ${delayMins%60}m`:""}`}</span>
              {delayMins < minRepeat && <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">Min {minRepeat} min on {planLimits?.name}</span>}
            </div>}
          </div>
          <label className="flex gap-2.5 mt-5 text-sm leading-5"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-0.5 accent-[#229ED9]" /><span>I confirm that I am authorized to communicate in the selected destinations and that this campaign complies with Telegram&apos;s rules and applicable laws.</span></label>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 mt-4 leading-5">⚠️ Please only send messages to communities where you have permission to communicate. Repeated unwanted messaging may result in Telegram restrictions.</div>
          {scheduledInfo?.repeating && <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-sm text-emerald-800 flex justify-between items-center">✅ Repeating every <b>{scheduledInfo.mins} min</b> — first send done, next in {scheduledInfo.mins} min. <button onClick={()=>{ const t=intervalRef.get(scheduledInfo.intervalId); if(t) clearInterval(t); intervalRef.delete(scheduledInfo.intervalId); setScheduledInfo(null); }} className="bg-white border border-emerald-300 px-3 py-1 rounded-full text-xs font-bold">Stop repeating</button></div>}
          <div className="flex gap-2 mt-5"><button onClick={() => setStep(2)} className="border border-[#E2E8F0] bg-white px-5 py-2.5 rounded-full text-sm font-semibold">Back</button><button onClick={startCampaign} disabled={sending} className="bg-[#229ED9] text-white px-7 py-3 rounded-full text-sm font-bold shadow-lg disabled:opacity-50">{sending ? "Sending…" : scheduleMode === "repeat" ? `Start repeating every ${delayMins < 60 ? delayMins+" min" : Math.floor(delayMins/60)+"h"+(delayMins%60?" "+delayMins%60+"m":"")} →` : "Start Campaign →"}</button></div>
        </div>
      </div>}
    </div>
  );
}

function CampaignsView() {
  const { campaigns, updateCampaign } = useStore() as any;
  const [f, setF] = useState("All");
  const list = f === "All" ? campaigns : campaigns.filter((c:any) => c.status === f);
  const intervalRef = (globalThis as any).__tgm_intervals as Map<string, any> | undefined;

  const stopRepeat = (c:any) => {
    updateCampaign(c.id, { status: "Paused" });
  };
  const resumeRepeat = async (c:any) => {
    // set nextRunAt so tick doesn't also fire at the same time as this manual send
    const mins = c.repeatEveryMins || c.delayMins || 15;
    updateCampaign(c.id, { status: "Repeating", nextRunAt: new Date(Date.now()+Number(mins)*60*1000).toISOString(), lastRunAt: new Date().toISOString() } as any);
    try {
      const body: any = { destinations: c.destinations, message: c.message };
      if (c.accountId) body.accountId = c.accountId;
      const r = await fetch("/api/telegram/send", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.ok) {
        const ok = j.results?.filter((x:any)=>x.status==="Sent").length ?? 0;
        const failed = (j.results?.length ?? 0) - ok;
        const newLogs = (j.results||[]).map((x:any)=>({ dest: x.dest, status: x.status, time: x.time || new Date().toISOString(), error: x.error || "" }));
        const mergedLogs = [...(c.logs||[]), ...newLogs];
        updateCampaign(c.id, { successful: (c.successful||0)+ok, failed: (c.failed||0)+failed, logs: mergedLogs.slice(-5000) });
      } else if (r.status === 429) {
        // account busy — tick will retry, don't spam
      }
    } catch {}
  };
  const cancelRepeat = (c:any) => {
    updateCampaign(c.id, { status: "Completed" });
  };
  const activeBanner = campaigns.filter((c:any)=>c.status==="Repeating");

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Campaigns</h1>
      {activeBanner.length > 0 && <div className="mt-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-2xl p-3 flex flex-wrap gap-2 items-center text-sm"><span className="w-2 h-2 bg-[#EFF6FF]0 rounded-full animate-pulse" /><span className="font-bold text-blue-800">{activeBanner.length} repeating</span><span className="text-blue-600 text-xs">— repeating campaigns have Pause & Stop.</span><button onClick={()=>setF("All")} className="ml-auto bg-[#229ED9] text-white px-3 py-1 rounded-full text-xs font-bold">Show all</button></div>}
      <div className="flex gap-2 mt-4 flex-wrap">{["All", "Completed", "Running", "Repeating", "Scheduled", "Paused", "Failed"].map(s => <button key={s} onClick={() => setF(s)} className={`px-4 py-2 rounded-full text-xs font-bold border transition ${f === s ? "bg-[#229ED9] text-white border-slate-900 shadow" : "bg-white border-[#E2E8F0] hover:bg-[#F8FAFC]"}`}>{s}</button>)}</div>
      <div className="space-y-3 mt-5">{list.map((c:any, idx:number) => {
        const isRepeating = c.status === "Repeating";
        const isRunning = c.status === "Running";
        const isPausedRepeating = c.status === "Paused" && c.repeatIntervalId;
        return <div key={`${c.id}-${idx}`} className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 flex flex-wrap justify-between items-center gap-3 hover:shadow-md transition shadow-sm">
          <div><div className="font-bold flex items-center gap-2">{c.name} {isRepeating && <span className="w-2 h-2 bg-[#EFF6FF]0 rounded-full animate-pulse" />} {isRepeating && <span className="text-[10px] font-bold tracking-widest bg-[#EFF6FF] text-blue-700 border border-[#BFDBFE] px-2 py-0.5 rounded-full">REPEATING every {c.repeatEveryMins||c.delayMins}m</span>}</div><div className="text-xs text-[#64748B] mt-1">{c.createdAt} · {c.destinations.length} destinations · {c.successful}✓ {c.failed}✕</div></div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${c.status === "Completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : c.status === "Repeating" ? "bg-[#EFF6FF] text-blue-700 border-[#BFDBFE]" : c.status === "Paused" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-50 border-[#E2E8F0]"}`}>{c.status}</span>
            {isRepeating && <><button onClick={()=>stopRepeat(c)} className="border border-amber-200 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1"><Pause size={12}/>Pause</button><button onClick={()=>cancelRepeat(c)} className="bg-red-50 border border-red-200 text-red-600 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1"><X size={12}/>Stop</button></>}
            {isPausedRepeating && <><button onClick={()=>resumeRepeat(c)} className="bg-emerald-600 text-white px-3 py-1.5 rounded-full text-xs font-bold">▶ Resume</button><button onClick={()=>cancelRepeat(c)} className="bg-red-50 border border-red-200 text-red-600 px-3 py-1.5 rounded-full text-xs font-bold">Stop</button></>}
          </div>
        </div>;
      })}
        {list.length === 0 && <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-10 text-center shadow-sm"><p className="font-bold">No campaigns yet</p><p className="text-sm text-[#64748B] mt-1">Create your first campaign to manage your Telegram communications.</p></div>}</div>
    </div>
  );
}

function TemplatesView() {
  const { templates, setTemplates } = useStore();
  const [mode, setMode] = useState<"list" | "create">("list");
  const [name, setName] = useState(""), [msg, setMsg] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const onTplImage = (f: File | null) => {
    setImage(f);
    if (f) { const r = new FileReader(); r.onload = () => setImagePreview(r.result as string); r.readAsDataURL(f); } else setImagePreview(null);
  };
  const reset = () => { setName(""); setMsg(""); setImage(null); setImagePreview(null); setEditingId(null); };
  const save = () => {
    if (!name.trim()) return alert("Template name required");
    if (!msg.trim() && !imagePreview) return alert("Add text or image");
    if (editingId) {
      setTemplates(templates.map((t: any) => t.id === editingId ? { ...t, name: name.trim(), message: msg, image: imagePreview } : t));
    } else {
      setTemplates([...templates, { id: (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2,9)), name: name.trim(), message: msg, image: imagePreview, category: "General" } as any]);
    }
    reset(); setMode("list");
  };
  const edit = (t: any) => { setEditingId(t.id); setName(t.name); setMsg(t.message || ""); setImagePreview(t.image || null); setImage(null); setMode("create"); };
  if (mode === "create") {
    return (
      <div>
        <div className="flex items-center gap-3"><button onClick={() => { reset(); setMode("list"); }} className="border border-[#E2E8F0] bg-white px-4 py-2 rounded-full text-xs font-bold">← Back</button><h1 className="text-2xl font-extrabold tracking-tight">{editingId ? "Edit Template" : "Create New Template"}</h1></div>
        <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 mt-4 shadow-sm space-y-4">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name" className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none" />
          <div>
            <div className="text-xs font-bold tracking-widest text-[#64748B] mb-2">MESSAGE TEXT</div>
            <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Template message" rows={5} maxLength={4096} className="w-full border border-[#E2E8F0] rounded-xl px-3.5 py-3 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-[#229ED9] outline-none" />
            <div className="text-xs text-[#64748B] mt-1">{msg.length} / 4096</div>
          </div>
          <div>
            <div className="text-xs font-bold tracking-widest text-[#64748B] mb-2">IMAGE (optional)</div>
            <label className="flex items-center gap-3 border border-dashed border-[#CBD5E1] rounded-xl px-4 py-3 cursor-pointer hover:bg-[#F8FAFC]">
              <input type="file" accept="image/*" className="hidden" onChange={e => onTplImage(e.target.files?.[0] || null)} />
              <span className="text-sm font-semibold text-[#229ED9]">{image ? "Change image" : "Upload image"}</span>
              <span className="text-xs text-[#64748B]">{image ? image.name : "JPG/PNG/WebP, max 8MB"}</span>
              {image && <button type="button" onClick={ev => { ev.preventDefault(); onTplImage(null); }} className="ml-auto text-xs font-bold text-red-600">Remove</button>}
            </label>
            {imagePreview && <img src={imagePreview} alt="preview" className="mt-3 rounded-xl border border-[#E2E8F0] max-h-52 object-contain" />}
          </div>
          <button onClick={save} className="bg-[#229ED9] text-white px-7 py-3 rounded-full text-sm font-bold shadow">Save Template</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div><h1 className="text-2xl font-extrabold tracking-tight">Message Templates</h1><p className="text-sm text-[#64748B]">Saved templates — create once, reuse in campaigns.</p></div>
        <button onClick={() => { reset(); setMode("create"); }} className="bg-[#229ED9] text-white px-6 py-2.5 rounded-full text-sm font-bold shadow">+ Create New Template</button>
      </div>
      {templates.length === 0 ? <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-10 mt-4 text-center shadow-sm"><p className="font-bold">No templates yet</p><p className="text-sm text-[#64748B] mt-1">Create your first template to reuse across campaigns.</p><button onClick={() => setMode("create")} className="mt-4 bg-[#229ED9] text-white px-6 py-2.5 rounded-full text-sm font-semibold">Create Template</button></div> :
      <div className="grid md:grid-cols-2 gap-3 mt-4">{templates.map((t: any) => <div key={t.id} className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 shadow-sm hover:shadow-md transition">
        <div className="flex justify-between items-start gap-2"><div className="font-bold">{t.name}</div><span className="text-[10px] font-bold tracking-widest bg-[#F1F5F9] border border-[#E2E8F0] px-2 py-0.5 rounded-full">{t.category || "General"}</span></div>
        {t.image && <img src={t.image} alt="" className="mt-3 rounded-xl border border-[#E2E8F0] max-h-40 object-contain" />}
        <div className="text-sm mt-2 leading-6 text-[#475569] whitespace-pre-wrap">{t.message || "(image only)"}</div>
        <div className="flex gap-2 mt-3"><button onClick={() => edit(t)} className="border border-[#E2E8F0] bg-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-[#F8FAFC]">Edit</button><button onClick={() => { if(confirm("Delete template?")) setTemplates(templates.filter((x:any)=>x.id!==t.id)); }} className="text-red-600 border border-red-200 bg-red-50 px-4 py-1.5 rounded-full text-xs font-bold">Delete</button></div>
      </div>)}</div>}
    </div>
  );
}

function SettingsView() {
  const { user, setUser, tg, setTg, tgAccounts, activeTgId, setActiveTgId, refreshTgAccounts, setView } = useStore() as any;
  const [switching, setSwitching] = useState<string | null>(null);
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [tgUsername, setTgUsername] = useState(user?.telegramUsername || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [subInfo, setSubInfo] = useState<any>(null);
  const [subLoading, setSubLoading] = useState(true);

  useEffect(() => { if (user?.name) setName(user.name); if (user?.email) setEmail(user.email); if (user?.telegramUsername !== undefined) setTgUsername(user.telegramUsername || ""); }, [user?.name, user?.email, user?.telegramUsername]);
  useEffect(() => { fetch("/api/subscription").then(r=>r.json()).then(j=>{ if(j.plan) setSubInfo(j); }).catch(()=>{}).finally(()=>setSubLoading(false)); }, []);

  const doSwitch = async (id: string) => {
    setSwitching(id);
    try {
      const r = await fetch("/api/telegram/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: id }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setActiveTgId(id);
      const acc = tgAccounts.find((a: any) => a.id === id);
      if (acc) setTg({ username: acc.username, phone: acc.phone, connected: true, displayName: acc.displayName, firstName: acc.firstName });
      await refreshTgAccounts();
    } catch (e: any) { alert(e.message); } finally { setSwitching(null); }
  };
  const doRemove = async (id: string) => {
    if (!confirm("Remove this Telegram account?")) return;
    try { const r = await fetch(`/api/telegram/accounts?id=${id}`, { method: "DELETE" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); await refreshTgAccounts(); } catch (e: any) { alert(e.message); }
  };

  const saveProfile = async () => {
    setProfileErr(""); setProfileMsg("");
    const n = name.trim(); const e = email.trim().toLowerCase(); const tg = tgUsername.trim().replace(/^@/, "");
    if (!n || n.length < 2) { setProfileErr("Name must be at least 2 characters"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setProfileErr("Enter a valid email"); return; }
    if (tg && !/^[a-zA-Z0-9_]{3,32}$/.test(tg)) { setProfileErr("Invalid Telegram username (3-32 letters, numbers, _)"); return; }
    if (n === user?.name && e === user?.email && tg === (user?.telegramUsername || "")) { setProfileErr("No changes to save"); return; }
    setSavingProfile(true);
    try {
      const r = await fetch("/api/auth/update", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n, email: e, telegramUsername: tg }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setUser(j.user); setProfileMsg("Account updated ✓");
      setTimeout(()=> setProfileMsg(""), 2500);
    } catch (e:any){ setProfileErr(e.message); } finally { setSavingProfile(false); }
  };

  const changePassword = async () => {
    setPwErr(""); setPwMsg("");
    if (!currentPassword || !newPassword || !confirmPassword) { setPwErr("Fill all password fields"); return; }
    if (newPassword.length < 6) { setPwErr("New password must be at least 6 characters"); return; }
    if (newPassword !== confirmPassword) { setPwErr("New passwords do not match"); return; }
    setPwSaving(true);
    try {
      const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setPwMsg("Password changed ✓"); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setTimeout(()=> setPwMsg(""), 2500);
    } catch (e:any){ setPwErr(e.message); } finally { setPwSaving(false); }
  };

  const deleteAccount = async () => {
    const ok = confirm("Delete your account permanently? This will remove your login. Telegram sessions and campaigns stay until you re-register. This cannot be undone.");
    if (!ok) return;
    const typed = prompt('Type DELETE to confirm:');
    if (typed !== 'DELETE') { alert('Cancelled — you must type DELETE exactly.'); return; }
    setDeleting(true);
    try {
      const r = await fetch("/api/auth/update", { method: "DELETE" });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      localStorage.removeItem("tgm_store");
      location.reload();
    } catch (e:any){ alert(e.message); } finally { setDeleting(false); }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">Settings</h1>
      <p className="text-[13px] text-slate-500 mt-1">Manage your workspace, login and connected Telegram accounts.</p>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#229ED9] flex items-center justify-center text-white font-semibold text-sm shrink-0">{(user?.name || user?.email || "?")[0].toUpperCase()}</div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{user?.name}</div>
            <div className="text-xs text-slate-500 truncate flex items-center gap-1.5"><Mail size={11} className="text-slate-400" />{user?.email}</div>
            {user?.telegramUsername && <div className="text-xs text-slate-500 truncate flex items-center gap-1"><AtSign size={11} className="text-slate-400" />@{user.telegramUsername}</div>}
          </div>
          <span className="ml-auto text-[11px] font-medium bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full text-slate-600">{tgAccounts?.length || 0}/10 Telegram</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">One email can connect up to 10 Telegram accounts. Switch the active one anytime.</p>
      </div>

      {/* Subscription / Plan in Settings */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center"><Sparkles size={14} className="text-white" /></div>
          <h3 className="text-sm font-semibold text-slate-900">Subscription</h3>
          <span className="ml-auto text-[10px] font-bold tracking-widest bg-slate-50 border border-slate-200 px-2 py-1 rounded-full text-slate-500">PLAN</span>
        </div>
        {subLoading ? <div className="text-xs text-slate-400 mt-3">Loading plan…</div> : subInfo?.plan ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className={`text-xs font-bold px-3 py-1 rounded-full border ${subInfo.plan.id === "luxe" ? "bg-gradient-to-r from-amber-500 to-pink-600 text-white border-transparent" : subInfo.plan.id === "max_plus" ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent" : subInfo.plan.id === "pro" ? "bg-[#229ED9] text-white border-transparent" : "bg-slate-50 text-slate-700 border-slate-200"}`}>{subInfo.plan.name} · {subInfo.subscription.billing === "daily" ? "Daily" : "Monthly"}</span>
              <span className="text-xs text-slate-500">Expires {new Date(subInfo.subscription.expiresAt).toLocaleString()}</span>
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"><div className="text-[10px] font-bold tracking-widest text-slate-400">CAMPAIGNS TODAY</div><div className="font-bold text-slate-900 mt-1">{subInfo.usage.campaignsToday}{subInfo.usage.campaignsLimit ? ` / ${subInfo.usage.campaignsLimit}` : " / Unlimited"}</div></div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"><div className="text-[10px] font-bold tracking-widest text-slate-400">FREE RENT TODAY</div><div className="font-bold text-slate-900 mt-1">{subInfo.usage.freeRentUsedToday} / {subInfo.usage.freeRentPerDay}</div></div>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setView("plans")} className="bg-[#229ED9] text-white px-4 py-2 rounded-full text-xs font-bold hover:bg-[#1B8AC4]">Manage in Plans →</button>
              <button onClick={() => setView("rent")} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-bold hover:bg-slate-50">Rent Accounts</button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">No active plan — redeem a key to activate.</div>
            <button onClick={() => setView("plans")} className="mt-3 bg-[#229ED9] text-white px-5 py-2 rounded-full text-xs font-bold hover:bg-[#1B8AC4]">Go to Plans →</button>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#229ED9] flex items-center justify-center"><AtSign size={14} className="text-white" /></div>
          <h3 className="text-sm font-semibold text-slate-900">Manage Account</h3>
          <span className="ml-auto text-[10px] font-bold tracking-widest bg-slate-50 border border-slate-200 px-2 py-1 rounded-full text-slate-500">LOGGED IN</span>
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">Update your display name, email and Telegram username.</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">Display name</label>
            <input value={name} onChange={e=> setName(e.target.value)} placeholder="Your name" className="mt-1 w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-slate-900 outline-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1"><Mail size={11} /> Email address</label>
            <input value={email} onChange={e=> setEmail(e.target.value)} placeholder="you@example.com" className="mt-1 w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-slate-900 outline-none" />
            <p className="text-[11px] text-slate-400 mt-1">Changing email will update your login email immediately.</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1"><Send size={11} /> Telegram username</label>
            <div className="relative mt-1"><span className="absolute left-3.5 top-3 text-slate-400 text-sm">@</span><input value={tgUsername} onChange={e=> setTgUsername(e.target.value)} placeholder="username (without @)" className="w-full border border-slate-200 rounded-xl pl-8 pr-3.5 py-2.5 text-sm focus:ring-2 focus:ring-[#229ED9]/20 focus:border-slate-900 outline-none" /></div>
            <p className="text-[11px] text-slate-400 mt-1">Optional — shown in Settings and used for support.</p>
          </div>
          {profileErr && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">{profileErr}</div>}
          {profileMsg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl px-3 py-2">{profileMsg}</div>}
          <button onClick={saveProfile} disabled={savingProfile} className="bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-[#1B8AC4] disabled:opacity-50 transition flex items-center gap-1.5"><Save size={14} />{savingProfile ? "Saving…" : "Save changes"}</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center"><KeyRound size={14} className="text-white" /></div>
          <h3 className="text-sm font-semibold text-slate-900">Change Password</h3>
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">Reset your account password. You need your current password to change it.</p>
        <div className="mt-4 space-y-3">
          <input value={currentPassword} onChange={e=> setCurrentPassword(e.target.value)} type="password" placeholder="Current password" className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
          <input value={newPassword} onChange={e=> setNewPassword(e.target.value)} type="password" placeholder="New password (min 6 chars)" className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
          <input value={confirmPassword} onChange={e=> setConfirmPassword(e.target.value)} type="password" placeholder="Confirm new password" className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
          {pwErr && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">{pwErr}</div>}
          {pwMsg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-xl px-3 py-2">{pwMsg}</div>}
          <button onClick={changePassword} disabled={pwSaving} className="bg-amber-500 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition flex items-center gap-1.5"><Lock size={14} />{pwSaving ? "Updating…" : "Update password"}</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Telegram Accounts</h3>
          <span className="text-xs font-medium bg-[#229ED9] text-white px-2.5 py-1 rounded-full">{tgAccounts?.length || 0}/10</span>
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">Campaigns and groups always use the active account. Switching is instant.</p>
        {!tgAccounts?.length ? (
          <div className="mt-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center">
            <div className="text-sm font-semibold text-slate-700">No Telegram accounts yet</div>
            <div className="text-xs text-slate-500 mt-1">Connect your first Telegram number to get started.</div>
            <button onClick={() => setView("connect")} className="mt-3 bg-[#229ED9] text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-[#1B8AC4] transition">Connect Telegram</button>
          </div>
        ) : (
          <div className="space-y-2 mt-4">
            {tgAccounts.map((a: any) => {
              const active = a.id === activeTgId;
              const initial = (a.displayName || a.username || a.phone || "?")[0].toUpperCase();
              return (
                <div key={a.id} className={`flex items-center gap-3 rounded-xl px-3.5 py-3 border transition ${active ? "bg-[#229ED9] border-slate-900" : "bg-white border-slate-200 hover:border-slate-300"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${active ? "bg-white text-slate-900" : "bg-slate-50 text-slate-700 border border-slate-200"}`}>{initial}</div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-semibold truncate flex items-center gap-2 ${active ? "text-white" : "text-slate-900"}`}>{a.displayName || a.username || a.phone}{active && <span className="text-[10px] font-bold tracking-widest bg-white text-slate-900 px-2 py-0.5 rounded-full">ACTIVE</span>}</div>
                    <div className={`text-xs truncate ${active ? "text-white/60" : "text-slate-500"}`}>{a.username ? `@${a.username}` : a.phone} · {a.phone}</div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {!active && <button onClick={() => doSwitch(a.id)} disabled={!!switching} className="text-xs font-semibold bg-white border border-slate-200 px-3 py-1.5 rounded-full hover:bg-slate-50 disabled:opacity-50 text-slate-900">{switching === a.id ? "…" : "Make active"}</button>}
                    <button onClick={() => doRemove(a.id)} className={`w-7 h-7 rounded-full flex items-center justify-center transition ${active ? "text-white/60 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200"}`} aria-label="Remove"><X size={12} /></button>
                  </div>
                </div>
              );
            })}
            {tgAccounts.length < 10 ? <button onClick={() => setView("connect")} className="w-full mt-1 bg-white border border-slate-200 text-slate-900 rounded-full py-2.5 text-xs font-semibold hover:bg-[#229ED9] hover:text-white hover:border-slate-900 transition">+ Add Telegram account</button> : <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">Limit reached — 10 accounts max.</div>}
          </div>
        )}
        {tg && <div className="mt-4 text-xs text-slate-500">Active now: <span className="font-semibold text-slate-900">@{tg.username || tg.phone}</span> — used for sending & dialogs.</div>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
        <h3 className="text-sm font-semibold text-slate-900">Security</h3>
        <p className="text-xs text-slate-500 mt-1">Sign out of this email on this device.</p>
        <button onClick={() => { localStorage.removeItem("tgm_store"); fetch("/api/auth/logout", { method: "POST" }).finally(() => location.reload()); }} className="mt-3 text-sm border border-slate-200 bg-white px-5 py-2.5 rounded-full font-semibold hover:bg-slate-50 text-slate-900 flex items-center gap-1.5"><LogOut size={14} /> Logout email</button>
      </div>

      <div className="bg-white border border-red-200 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-red-600 flex items-center justify-center"><Trash2 size={14} className="text-white" /></div>
          <h3 className="text-sm font-semibold text-red-700">Danger Zone</h3>
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">Permanently delete your login account. You will be logged out and will need to register again to use the app.</p>
        <button onClick={deleteAccount} disabled={deleting} className="mt-3 bg-red-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition flex items-center gap-1.5"><Trash2 size={14} />{deleting ? "Deleting…" : "Delete account"}</button>
      </div>
    </div>
  );
}

function DeliveryLogsView() {
  const { campaigns, dests } = useStore();
  const [filter, setFilter] = useState("All");
  const [campaignFilter, setCampaignFilter] = useState("All");

  const destMap = Object.fromEntries(dests.map(d => [d.id, d]));

  // Build flat rows: every log entry is a row — so a repeating campaign that sent 1000 messages shows 1000 rows
  const rows = campaigns.flatMap(c => {
    const logs = (c as any).logs || [];
    const isRepeatingLike = c.status === "Repeating" || logs.length > (c.destinations?.length || 0);
    if (isRepeatingLike && logs.length) {
      return logs.map((log: any) => {
        const d = destMap[String(log.dest)];
        return { campaign: c.name, campaignId: c.id, campaignStatus: c.status, createdAt: c.createdAt, destTitle: d?.title || String(log.dest), destType: d?.type || "-", destMembers: d?.members ?? "-", status: log.status || "Sent", time: log.time || c.createdAt, error: log.error || "" };
      });
    }
    if (!logs.length) {
      if (c.status === "Completed") {
        return c.destinations.map((did: string) => {
          const d = destMap[did];
          return { campaign: c.name, campaignId: c.id, campaignStatus: c.status, createdAt: c.createdAt, destTitle: d?.title || did, destType: d?.type || "-", destMembers: d?.members ?? "-", status: "Sent" as const, time: c.createdAt, error: "" };
        });
      }
      if (c.status === "Failed") {
        return c.destinations.map((did: string) => {
          const d = destMap[did];
          return { campaign: c.name, campaignId: c.id, campaignStatus: c.status, createdAt: c.createdAt, destTitle: d?.title || did, destType: d?.type || "-", destMembers: d?.members ?? "-", status: "Failed" as const, time: c.createdAt, error: "" };
        });
      }
    }
    return c.destinations.map((did: string) => {
      const d = destMap[did];
      const log = logs.find((l: any) => String(l.dest) === String(did));
      let status = (log?.status as string) || (c.status === "Completed" ? "Sent" : c.status === "Failed" ? "Failed" : c.status === "Paused" ? "Paused" : "Pending");
      if (status === "Pending" && c.status === "Completed") status = "Sent";
      return { campaign: c.name, campaignId: c.id, campaignStatus: c.status, createdAt: c.createdAt, destTitle: d?.title || did, destType: d?.type || "-", destMembers: d?.members ?? "-", status, time: log?.time || c.createdAt, error: log?.error || "" };
    });
  });

  let filtered = rows;
  if (campaignFilter !== "All") filtered = filtered.filter(r => r.campaignId === campaignFilter);
  if (filter !== "All") filtered = filtered.filter(r => r.status === filter);

  const exportExcel = () => {
    if (!filtered.length) return alert("No data to export");
    const headers = ["Campaign", "Campaign Status", "Created", "Destination", "Type", "Members", "Delivery Status", "Time", "Error"];
    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(","), ...filtered.map(r => [r.campaign, r.campaignStatus, r.createdAt, r.destTitle, r.destType, r.destMembers, r.status, r.time, r.error].map(escape).join(","))].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `delivery-logs-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div><h1 className="text-2xl font-extrabold tracking-tight">Delivery Logs</h1><p className="text-sm text-[#64748B]">Per-destination delivery history — export to Excel.</p></div>
        <button onClick={exportExcel} className="bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 shadow hover:bg-[#1B8AC4] transition"><Download size={16} /> Export Excel</button>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <select value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)} className="border border-[#E2E8F0] bg-white rounded-full px-4 py-2 text-sm font-medium">
          <option value="All">All campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {["All", "Sent", "Failed", "Pending", "Paused"].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-4 py-2 rounded-full text-xs font-bold border transition ${filter === s ? "bg-[#229ED9] text-white border-slate-900" : "bg-white border-[#E2E8F0] hover:bg-[#F8FAFC]"}`}>{s}</button>
        ))}
      </div>
      <div className="bg-white border border-[#E2E8F0] rounded-[20px] mt-4 overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-[#F8FAFC] text-xs font-bold tracking-widest text-[#64748B]"><tr><th className="text-left px-4 py-3">CAMPAIGN</th><th className="text-left px-4">DESTINATION</th><th className="px-4">TYPE</th><th className="px-4">STATUS</th><th className="px-4">TIME</th><th className="text-left px-4">ERROR</th></tr></thead>
          <tbody>{filtered.map((r, i) => <tr key={i} className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC]/60"><td className="px-4 py-3"><div className="font-semibold">{r.campaign}</div><div className="text-xs text-[#94A3B8]">{r.createdAt}</div></td><td className="px-4 font-medium">{r.destTitle}</td><td className="px-4"><span className="bg-[#F1F5F9] px-2 py-1 rounded-full text-xs">{r.destType}</span></td><td className="px-4"><span className={`px-2 py-1 rounded-full text-xs font-bold border ${r.status === "Sent" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : r.status === "Failed" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{r.status}</span></td><td className="px-4 text-xs text-[#64748B]">{r.time}</td><td className="px-4 text-xs text-red-500">{r.error || "—"}</td></tr>)}</tbody>
        </table>
        {filtered.length === 0 && <div className="p-10 text-center text-sm text-[#64748B]">No logs match the selected filters.</div>}
      </div>
      <p className="text-xs text-[#94A3B8] mt-2">{filtered.length} rows • opens directly in Excel (CSV with UTF-8 BOM).</p>
    </div>
  );
}

function HelpView() {
  const [openFaq, setOpenFaq] = useState<string | null>("what");
  const [showDocs, setShowDocs] = useState(false);
  // Replace these with your real YouTube links — English & Hindi
  const YT_EN = "https://www.youtube.com/watch?v=YOUR_ENGLISH_VIDEO_ID";
  const YT_HI = "https://www.youtube.com/watch?v=YOUR_HINDI_VIDEO_ID";
  const DOCS_URL = "#docs";
  const faqs: Array<[string,string,string]> = [
    ["what","What is Subplus & what does it do?","Subplus is a premium Telegram workspace. Connect your Telegram account, manage all your groups & channels in one place, create a message once, and send it to many authorized destinations — with delivery tracking, scheduling, repeats, templates and rented sender accounts. It never bypasses Telegram rules: only destinations where you have permission to post are shown."],
    ["connect","How do I connect my Telegram?","Go to Accounts → Connect Telegram. Enter your phone → get OTP from Telegram → enter OTP → if 2FA is on, enter your Telegram password. Your session is encrypted server-side (httpOnly cookie) and never exposed to the browser. You can connect up to 10 accounts per email and switch the active one instantly."],
    ["groups","How do Groups & Joiner work?","My Groups shows all groups/channels of the active Telegram account (live via Telegram API). Use Join Groups to paste invite links (t.me/+..., t.me/joinchat/..., t.me/username, @username) — one per line, no limit. Duplicates are removed, progress is shown, and rate-limits are handled. After joining, hit Refresh My Groups."],
    ["campaign","How do I create & send a campaign?","Create Campaign → 1) Select destinations (only Allowed ones are selectable; Restricted are red and blocked) → 2) Write message + optional image (or load a Template) → 3) Review, pick sender account, choose Send once or Repeat every N minutes, confirm authorization → Start. You get a live progress view with Sent / Pending / Rejected / Limited and per-destination logs."],
    ["repeat","How does Repeat work?","In Review step choose Repeat every… (e.g. every 15 min). The campaign sends immediately, then repeats server-side every N minutes — even if you close the browser. Manage it in Campaigns: Pause, Resume or Stop. Minimum interval depends on your plan (Elite 15m, Pro/Max+/Luxe 1m)."],
    ["rent","How do rented accounts work ($1 / 24h)?","Rent Accounts → Marketplace shows available senders at $1 per 24h. Click Pay & Rent (or Claim Free if your plan includes free rentals) — 1 click, the account is auto-added to your Accounts and appears in the Create Campaign sender dropdown. After 24h it auto-expires and returns to the pool. No manual cleanup."],
    ["plans","How do Plans & license keys work?","Plans are key-based. Buy a plan → admin confirms payment → you get a license key → redeem it in Plans → activated instantly. Daily keys last 24h, monthly 30 days. Limits: groups per campaign, campaigns per day, repeat interval and free rentals per day all depend on plan."],
    ["templates","What are Templates?","Save a message + image as a template (Templates → Create). Reuse it in Create Campaign step 2 via the template dropdown — it auto-fills message and image. Edit or delete anytime."],
    ["logs","What are Delivery Logs?","Every send is logged per destination. Delivery Logs shows a flat table (one row per destination per send — so a repeating campaign that sent 1000 messages shows 1000 rows). Filter by campaign or status, and Export Excel (CSV with UTF-8 BOM, opens directly in Excel)."],
    ["safe","Is this safe / does it bypass Telegram limits?","No bypass. Subplus respects flood-wait and rate limits, only posts where you have permission, and auto-pauses on rate-limit. Repeated unwanted messaging can still trigger Telegram restrictions — only message communities where you are authorized."],
  ];
  return (
    <div className="max-w-4xl space-y-4">
      <div className="bg-gradient-to-br from-[#134E4A] to-[#1E293B] rounded-[24px] p-6 md:p-7 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#229ED9]/10 rounded-full blur-3xl -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-violet-500/10 rounded-full blur-3xl -ml-10 -mb-10" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/10 rounded-full px-3 py-1 text-xs font-bold tracking-widest"><GraduationCap size={14} /> HELP & SUPPORT</div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-3">How Subplus works — everything in one place</h1>
          <p className="text-sm text-white/70 mt-2 leading-6 max-w-2xl">From connecting Telegram to sending your first campaign — step-by-step. Watch a video, read the docs, or ask us directly. We respect Telegram rules and only allow authorized destinations.</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={()=>document.getElementById("help-how")?.scrollIntoView({behavior:"smooth"})} className="bg-white text-slate-900 px-5 py-2.5 rounded-full text-xs font-bold flex items-center gap-1.5 hover:bg-slate-50"><ListChecks size={14}/> How to use — step by step</button>
            <a href={YT_EN} target="_blank" rel="noopener noreferrer" className="bg-red-600 text-white px-5 py-2.5 rounded-full text-xs font-bold flex items-center gap-1.5 hover:bg-red-700"><Video size={14}/> Watch in English</a>
            <a href={YT_HI} target="_blank" rel="noopener noreferrer" className="bg-white/10 border border-white/20 text-white px-5 py-2.5 rounded-full text-xs font-bold flex items-center gap-1.5 hover:bg-white/20"><Video size={14}/> हिंदी में देखें</a>
          </div>
          <p className="text-[11px] text-white/40 mt-2">Replace YouTube links in <code className="bg-white/10 px-1 rounded">src/app/page.tsx</code> → <code className="bg-white/10 px-1 rounded">YT_EN / YT_HI</code></p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <a href={YT_EN} target="_blank" rel="noopener noreferrer" className="bg-white border border-[#E2E8F0] rounded-2xl p-4 hover:border-red-200 hover:shadow-lg hover:shadow-red-500/10 transition group">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center group-hover:bg-red-600 transition"><Video size={18} className="text-red-600 group-hover:text-white transition" /></div>
          <div className="text-sm font-bold mt-3 flex items-center gap-1.5">Watch Tutorial — English <ExternalLink size={12} className="text-slate-400"/></div>
          <div className="text-xs text-slate-500 mt-1 leading-relaxed">Full walkthrough in English — connect, groups, campaign, rent & plans.</div>
          <span className="mt-3 inline-flex bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-full group-hover:bg-red-700">Watch on YouTube →</span>
        </a>
        <a href={YT_HI} target="_blank" rel="noopener noreferrer" className="bg-white border border-[#E2E8F0] rounded-2xl p-4 hover:border-[#BFDBFE] hover:shadow-lg hover:shadow-blue-500/10 transition group">
          <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center group-hover:bg-[#EFF6FF]0 transition"><Video size={18} className="text-[#229ED9] group-hover:text-white transition" /></div>
          <div className="text-sm font-bold mt-3 flex items-center gap-1.5">वीडियो देखें — हिंदी <ExternalLink size={12} className="text-slate-400"/></div>
          <div className="text-xs text-slate-500 mt-1 leading-relaxed">पूरा ट्यूटोरियल हिंदी में — कनेक्ट से लेकर कैंपेन तक।</div>
          <span className="mt-3 inline-flex bg-[#229ED9] text-white text-xs font-bold px-4 py-2 rounded-full group-hover:bg-[#1B8AC4]">YouTube पर देखें →</span>
        </a>
        <button onClick={()=>setShowDocs(v=>!v)} className="text-left bg-gradient-to-br from-violet-600 to-indigo-700 rounded-2xl p-4 text-white hover:shadow-xl hover:shadow-violet-500/20 transition group">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><BookOpen size={18} className="text-white" /></div>
          <div className="text-sm font-bold mt-3 flex items-center gap-1.5">Full Docs — How to use <ChevronRight size={12} className={`transition ${showDocs?"rotate-90":""}`} /></div>
          <div className="text-xs text-white/70 mt-1 leading-relaxed">Step-by-step guide covering every feature — scroll or jump to any section.</div>
          <span className="mt-3 inline-flex bg-white text-violet-700 text-xs font-bold px-4 py-2 rounded-full">{showDocs?"Hide docs":"Read docs →"}</span>
        </button>
      </div>

      <div id="help-how" className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 md:p-6 shadow-sm">
        <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-xl bg-[#229ED9] flex items-center justify-center"><ListChecks size={14} className="text-white"/></div><h2 className="font-extrabold">How to use Subplus — 6 steps</h2><span className="ml-auto text-[10px] font-bold tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-full">START HERE</span></div>
        <div className="mt-4 grid md:grid-cols-3 gap-3">
          {[
            ["1","Create account & login","Sign up with email + password, then login. Your workspace is ready."],
            ["2","Connect Telegram","Accounts → Connect → phone → OTP → 2FA if needed. Up to 10 accounts per email."],
            ["3","Load & join groups","Groups & Joiner → Refresh to load live groups. Paste invite links to join new ones."],
            ["4","Create campaign","Create Campaign → pick destinations → write message + image → review & choose sender."],
            ["5","Send & track","Send once or Repeat every N min. Watch live progress, then check Delivery Logs & export."],
            ["6","Rent & scale","Rent Accounts → $1/24h, 1-click. Rented sender appears in campaign sender dropdown."],
          ].map(([n,t,d])=> <div key={n} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-4"><div className="w-7 h-7 rounded-full bg-[#229ED9] text-white flex items-center justify-center text-xs font-extrabold">{n}</div><div className="text-sm font-bold mt-2">{t}</div><div className="text-xs text-slate-500 mt-1 leading-relaxed">{d}</div></div>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={YT_EN} target="_blank" rel="noopener noreferrer" className="bg-red-600 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"><Play size={12}/> Watch English</a>
          <a href={YT_HI} target="_blank" rel="noopener noreferrer" className="border border-[#E2E8F0] bg-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"><Play size={12}/> हिंदी वीडियो</a>
          <button onClick={()=>setShowDocs(true)} className="bg-[#229ED9] text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"><BookOpen size={12}/> Open full docs</button>
        </div>
      </div>

      {showDocs && <div id="docs" className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 md:p-6 shadow-sm">
        <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center"><BookOpen size={14} className="text-white"/></div><h2 className="font-extrabold">Full documentation — every feature explained</h2></div>
        <p className="text-xs text-slate-500 mt-1">Everything Subplus can do, in order. Use this as your manual.</p>
        <div className="mt-4 space-y-4 text-sm leading-6">
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><LayoutDashboard size={14}/> Dashboard</h3><p className="text-slate-600 mt-1">Live overview: messages sent today vs all time, total groups, connected account, eligible destinations, campaigns and delivery rate. Recent campaigns table with status dots.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><Users size={14}/> Accounts</h3><p className="text-slate-600 mt-1">Manage up to 10 Telegram accounts per email. The active account is used for all campaigns, groups and logs. Switch instantly, remove anytime, add another via Connect. Each card shows messages/groups/campaigns for that account.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><Search size={14}/> Groups & Joiner</h3><p className="text-slate-600 mt-1"><b>My Groups:</b> live list from Telegram (title, type, privacy, members, permission). Search, filter by Private/Public, Leave any group. <b>Join Groups:</b> paste invite links one per line — supports t.me/+..., t.me/joinchat/..., t.me/username, @username, https://t.me/... — no limit, duplicates removed, chunked with progress and rate-limit handling.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><Megaphone size={14}/> Create Campaign</h3><p className="text-slate-600 mt-1"><b>Step 1 — Destinations:</b> only Allowed groups are selectable; Restricted are red and blocked. Select all, hide restricted, live eligible count, plan limits enforced (groups/campaign, campaigns/day). <b>Step 2 — Message:</b> campaign name, message text (4096 chars), optional image, or load a saved Template. <b>Step 3 — Review:</b> Telegram preview, sender dropdown (including rented senders), Send once vs Repeat every N min, authorization checkbox, then Start. Live progress shows Sent/Pending/Rejected/Limited and per-destination logs with Export CSV.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><History size={14}/> Campaigns</h3><p className="text-slate-600 mt-1">All campaigns with filters (All/Completed/Running/Repeating/Scheduled/Paused/Failed). Repeating campaigns show Pause/Stop (and Resume if paused). Each card shows name, time, destinations, success/fail counts and status badge.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><FileText size={14}/> Templates</h3><p className="text-slate-600 mt-1">Create reusable message + image templates. Use them in Create Campaign step 2 — selecting a template auto-fills message and image. Edit or delete anytime.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><BarChart3 size={14}/> Delivery Logs</h3><p className="text-slate-600 mt-1">Flat per-destination history — every send is a row (so a repeating campaign that sent 1000 messages shows 1000 rows). Filter by campaign or status (Sent/Failed/Pending/Paused), then Export Excel (CSV with UTF-8 BOM).</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><Star size={14}/> Rent Accounts — $1 / 24h</h3><p className="text-slate-600 mt-1">Marketplace of sender accounts at $1 per 24h. One click Pay & Rent (or Claim Free if your plan includes free rentals) — auto-added to Accounts and appears in campaign sender dropdown. Auto-expires after 24h and returns to pool. Admin adds accounts via phone → OTP → 2FA → auto-listed.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><Sparkles size={14}/> Plans</h3><p className="text-slate-600 mt-1">Key-based subscriptions. Buy → admin confirms → you get a license key → redeem in Plans → activated. Daily (24h) or monthly (30 days). Limits per plan: groups per campaign, campaigns per day, repeat interval, free rentals per day. Compare table included.</p></div>
          <div className="border border-[#E2E8F0] rounded-2xl p-4"><h3 className="font-bold flex items-center gap-2"><Settings size={14}/> Settings</h3><p className="text-slate-600 mt-1">Manage display name, email, Telegram username, change password, view subscription and Telegram accounts, switch active account, logout or delete account.</p></div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs leading-5 text-amber-900"><b>⚠️ Important:</b> Only message communities where you have permission. Subplus respects Telegram flood-wait and rate limits and only shows destinations you can post in — but repeated unwanted messaging can still trigger Telegram restrictions.</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={YT_EN} target="_blank" rel="noopener noreferrer" className="bg-red-600 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"><Video size={12}/> Watch English</a>
          <a href={YT_HI} target="_blank" rel="noopener noreferrer" className="border border-[#E2E8F0] bg-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"><Video size={12}/> हिंदी वीडियो</a>
          <button onClick={()=>setShowDocs(false)} className="border border-[#E2E8F0] bg-white px-4 py-2 rounded-full text-xs font-bold">Close docs</button>
        </div>
      </div>}

      <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-5 md:p-6 shadow-sm">
        <h2 className="font-extrabold flex items-center gap-2"><HelpCircle size={16}/> Frequently asked — tap to expand</h2>
        <div className="mt-4 space-y-2">
          {faqs.map(([id,q,a])=> (
            <div key={id} className="border border-[#E2E8F0] rounded-xl overflow-hidden">
              <button onClick={()=>setOpenFaq(openFaq===id?null:id)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F8FAFC]">
                <span className="text-sm font-semibold pr-2">{q}</span>
                <ChevronRight size={14} className={`shrink-0 text-slate-400 transition ${openFaq===id?"rotate-90":""}`} />
              </button>
              {openFaq===id && <div className="px-4 pb-3 text-sm text-slate-600 leading-6 border-t border-[#F1F5F9] pt-3 bg-[#F8FAFC]/50">{a}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-[20px] p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center shrink-0"><Mail size={16} className="text-white" /></div>
          <div>
            <h2 className="font-bold text-[15px] text-slate-900">Need help? We're here.</h2>
            <p className="text-sm text-[#64748B] mt-1 leading-6">Email us at <a href="mailto:contact@tgmessenger.app" className="text-[#229ED9] font-semibold hover:underline">contact@tgmessenger.app</a> — we respect Telegram rules and only allow authorized destinations. Average response under 2 hours.</p>
          </div>
          <span className="hidden sm:inline-flex ml-auto text-[11px] font-bold tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full shrink-0">24/7</span>
        </div>
      </div>
      <div className="bg-white border border-[#E2E8F0] rounded-[24px] overflow-hidden shadow-sm">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-[#0F172A] px-6 py-5 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#229ED9]/10 rounded-full blur-3xl -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-violet-500/10 rounded-full blur-2xl -ml-10 -mb-10" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/10 border border-white/15 rounded-full px-3 py-1 text-[11px] font-bold tracking-widest backdrop-blur"><MessageCircle size={12} /> GET SUPPORT</div>
              <h3 className="text-lg font-extrabold tracking-tight mt-3">Talk to a real person — fast.</h3>
              <p className="text-sm text-white/60 mt-1 leading-6">Choose how you want to reach us. We typically reply within 15 minutes, 24/7.</p>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-[11px] font-semibold bg-white/10 border border-white/15 rounded-full px-3 py-1.5 backdrop-blur shrink-0"><span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" /> Avg. reply &lt; 15 min</div>
          </div>
        </div>
        <div className="p-5 grid md:grid-cols-2 gap-4 bg-[#F8FAFC]/50">
          <a href="https://t.me/princerana" target="_blank" rel="noopener noreferrer" className="group bg-white border border-[#E2E8F0] rounded-2xl p-5 hover:border-[#229ED9]/30 hover:shadow-lg hover:shadow-[#229ED9]/5 hover:-translate-y-0.5 transition-all">
            <div className="flex items-start justify-between gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#229ED9] to-[#1B8AC4] flex items-center justify-center shadow-md shadow-[#229ED9]/20 group-hover:scale-105 transition-transform"><Send size={18} className="text-white" /></div>
              <span className="text-[10px] font-bold tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-full">24/7 · RECOMMENDED</span>
            </div>
            <h4 className="font-bold text-sm mt-4 text-slate-900">Personal Support — 1:1 Chat</h4>
            <p className="text-xs font-semibold text-[#229ED9] mt-0.5">@princerana</p>
            <p className="text-xs text-[#64748B] mt-2 leading-5">Direct chat for billing, setup, payments & troubleshooting. Real human, no bots.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full"><Clock size={11} className="text-slate-400" /> &lt; 15 min reply</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full"><ShieldCheck size={11} className="text-emerald-600" /> Trusted</span>
            </div>
            <span className="mt-4 inline-flex items-center gap-1.5 bg-[#229ED9] text-white text-xs font-bold px-4 py-2 rounded-full group-hover:bg-[#1B8AC4] group-hover:shadow-md transition">Message on Telegram <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" /></span>
          </a>
          <a href="https://t.me/princerana" target="_blank" rel="noopener noreferrer" className="group bg-white border border-[#E2E8F0] rounded-2xl p-5 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-500/5 hover:-translate-y-0.5 transition-all">
            <div className="flex items-start justify-between gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-500/20 group-hover:scale-105 transition-transform"><Megaphone size={18} className="text-white" /></div>
              <span className="text-[10px] font-bold tracking-widest bg-violet-50 text-violet-700 border border-violet-200 px-2 py-1 rounded-full">UPDATES</span>
            </div>
            <h4 className="font-bold text-sm mt-4 text-slate-900">Official Channel</h4>
            <p className="text-xs font-semibold text-violet-600 mt-0.5">Announcements & releases</p>
            <p className="text-xs text-[#64748B] mt-2 leading-5">Product updates, new features & maintenance notices. No spam — only important info.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full"><Zap size={11} className="text-amber-500" /> Instant updates</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">No spam</span>
            </div>
            <span className="mt-4 inline-flex items-center gap-1.5 bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-full group-hover:bg-black group-hover:shadow-md transition">Join Channel <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" /></span>
          </a>
        </div>
        <div className="px-5 py-3 bg-white border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-[#64748B] flex items-center gap-1.5"><Mail size={12} className="text-slate-400" /> <a href="mailto:contact@tgmessenger.app" className="font-semibold text-slate-700 hover:text-[#229ED9]">contact@tgmessenger.app</a> <span className="text-slate-300">·</span> We reply within 2 hours</span>
          <span className="text-[11px] text-slate-400">Available in English & Hindi · 24/7</span>
        </div>
      </div>
    </div>
  );
}

function AppInner() {
  const { view, setView, user } = useStore();
  if (view === "landing") return <Landing onNav={setView} />;
  if (view === "login") return <Auth mode="login" onNav={setView} />;
  if (view === "signup") return <Auth mode="signup" onNav={setView} />;
  if (view === "connect") return <Connect onNav={setView} />;
  if (!user) return <Auth mode="login" onNav={setView} />;
  let content: React.ReactNode = null;
  if (view === "dashboard") content = <DashboardView onNav={setView} />;
  else if (view === "destinations") content = <DestinationsView />;
  else if (view === "accounts") content = <AccountsView />;
  else if (view === "plans") content = <PlansView />;
  else if (view === "rent") content = <RentAccountsView />;
  else if (view === "create") content = <CreateCampaign />;
  else if (view === "campaigns") content = <CampaignsView />;
  else if (view === "templates") content = <TemplatesView />;
  else if (view === "logs") content = <DeliveryLogsView />;
  else if (view === "settings") content = <SettingsView />;
  else if (view === "admin") content = <AdminPanel />;
  else if (view === "help") content = <HelpView />;
  else content = <DashboardView onNav={setView} />;
  return <Shell onNav={setView}>{content}</Shell>;
}

export default function Home() {
  return <StoreProvider><AppInner /></StoreProvider>;
}
