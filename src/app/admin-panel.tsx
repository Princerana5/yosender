"use client";
import { useState, useEffect } from "react";
import { ShieldCheck, Users, BarChart, Key, Server, CreditCard, Megaphone, Search, Mail, AlertTriangle, Copy, Plus, UserPlus, Shield, Check, X as XIcon, Settings2, Trash2 } from "lucide-react";

const PERM_LABELS: Record<string, { label: string; desc: string }> = {
  overview: { label: "Overview", desc: "View dashboard stats & counts" },
  users: { label: "Users", desc: "View, ban, reset password, delete users" },
  rentals: { label: "Rented Accounts", desc: "Add pool accounts, ban, force-free, delete" },
  keys: { label: "License Keys", desc: "Generate & revoke license keys" },
  subs: { label: "Subscriptions", desc: "View, revoke & extend subscriptions" },
  campaigns: { label: "Campaigns", desc: "View all campaigns" },
  team: { label: "Team", desc: "Invite & manage team members" },
  payments: { label: "Payments", desc: "View crypto payments, verify & confirm" },
};

export function AdminPanel() {
  const [tab, setTab] = useState<"overview" | "users" | "rentals" | "keys" | "subs" | "campaigns" | "team" | "payments">("overview");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [myPerms, setMyPerms] = useState<string[] | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersFilter, setUsersFilter] = useState("all");
  const [pool, setPool] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [paymentsFilter, setPaymentsFilter] = useState("all");
  const [paymentsSummary, setPaymentsSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [showAddRental, setShowAddRental] = useState(false);
  const [newRental, setNewRental] = useState({ phone: "", username: "", displayName: "", firstName: "", session: "", pricePerDay: 1 });
  // Telegram auto-list flow: phone -> OTP -> 2FA -> auto-added to pool at $1/24h
  const [tgPhone, setTgPhone] = useState("+91 ");
  const [tgCode, setTgCode] = useState("");
  const [tgPwd, setTgPwd] = useState("");
  const [tgHash, setTgHash] = useState("");
  const [tgStep, setTgStep] = useState<1|2|3>(1);
  const [tgLoading, setTgLoading] = useState(false);
  const [genPlan, setGenPlan] = useState("pro");
  const [genBilling, setGenBilling] = useState<"daily"|"monthly">("monthly");
  const [genCount, setGenCount] = useState(1);
  const [genNote, setGenNote] = useState("");
  // Team invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePerms, setInvitePerms] = useState<string[]>(["overview"]);
  const [editingPerms, setEditingPerms] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const checkAdmin = async () => {
    try {
      const r = await fetch("/api/admin/overview");
      if (r.ok) { setIsAdmin(true); const j = await r.json(); setOverview(j); }
      else { setIsAdmin(false); const j = await r.json().catch(()=>({} as any)); setErr(j.error || "Not admin"); }
    } catch (e: any) { setIsAdmin(false); setErr(e.message); }
  };
  const loadMe = async () => {
    try { const r = await fetch("/api/admin/me"); const j = await r.json(); if (r.ok) { setMyPerms(j.permissions || []); setIsOwner(!!j.isOwner); } } catch {}
  };
  useEffect(() => { checkAdmin(); loadMe(); }, []);

  const loadUsers = async (page = 1) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/users?page=${page}&limit=20&search=${encodeURIComponent(usersSearch)}&filter=${usersFilter}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setUsers(j.users); setUsersTotal(j.total); setUsersPage(page);
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const loadPool = async () => {
    setLoading(true);
    try { const r = await fetch("/api/admin/rental-pool"); const j = await r.json(); if (!r.ok) throw new Error(j.error); setPool(j.pool); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const loadKeys = async () => {
    setLoading(true);
    try { const r = await fetch("/api/admin/keys"); const j = await r.json(); if (!r.ok) throw new Error(j.error); setKeys(j.keys); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const loadSubs = async () => {
    setLoading(true);
    try { const r = await fetch("/api/admin/subscriptions"); const j = await r.json(); if (!r.ok) throw new Error(j.error); setSubs(j.subscriptions); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const loadCampaigns = async () => {
    setLoading(true);
    try { const r = await fetch("/api/admin/campaigns?limit=50"); const j = await r.json(); if (!r.ok) throw new Error(j.error); setCampaigns(j.campaigns); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const loadTeam = async () => {
    setLoading(true);
    try { const r = await fetch("/api/admin/team"); const j = await r.json(); if (!r.ok) throw new Error(j.error); setTeam(j.team); } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const loadPayments = async (page = 1) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/payments?page=${page}&limit=20&search=${encodeURIComponent(paymentsSearch)}&status=${paymentsFilter}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPayments(j.payments); setPaymentsTotal(j.total); setPaymentsPage(page); setPaymentsSummary(j.summary);
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  };
  const paymentAction = async (orderId: string, action: string) => {
    setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, action }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsg(j.message || `${action} done`);
      loadPayments(paymentsPage);
      setTimeout(()=>setMsg(""), 4000);
    } catch (e: any) { setErr(e.message); }
  };
  const inviteTeam = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) { setErr("Enter a valid email"); return; }
    if (!invitePerms.length) { setErr("Pick at least one permission"); return; }
    setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim(), permissions: invitePerms }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg(`Invited ${j.member.email} — ${j.member.permissions.join(", ")}`);
      setInviteEmail(""); setInviteName(""); setInvitePerms(["overview"]);
      loadTeam();
      setTimeout(()=>setMsg(""), 4000);
    } catch (e: any) { setErr(e.message); }
  };
  const teamAction = async (id: string, action: string, extra?: any) => {
    setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg(action === "revoke" ? "Access revoked" : action === "reinstate" ? "Access restored" : "Updated");
      loadTeam();
      setTimeout(()=>setMsg(""), 3000);
    } catch (e: any) { setErr(e.message); }
  };
  const deleteTeam = async (id: string) => {
    if (!confirm("Remove this team member permanently?")) return;
    try { const r = await fetch(`/api/admin/team?id=${id}`, { method: "DELETE" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMsg("Team member removed"); loadTeam(); } catch (e: any) { setErr(e.message); }
  };

  useEffect(() => {
    if (isAdmin !== true) return;
    if (tab === "users") loadUsers(1);
    else if (tab === "rentals") loadPool();
    else if (tab === "keys") loadKeys();
    else if (tab === "subs") loadSubs();
    else if (tab === "campaigns") loadCampaigns();
    else if (tab === "team") loadTeam();
    else if (tab === "payments") loadPayments(1);
    else if (tab === "overview") checkAdmin();
  }, [tab]);

  const doUserAction = async (id: string, action: string, extra?: any) => {
    setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg(action === "ban" ? "User banned" : action === "unban" ? "User unbanned" : "Password reset");
      loadUsers(usersPage);
      setTimeout(()=>setMsg(""), 3000);
    } catch (e: any) { setErr(e.message); }
  };
  const deleteUser = async (id: string) => {
    if (!confirm("Delete this user permanently?")) return;
    try { const r = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMsg("User deleted"); loadUsers(usersPage); } catch (e: any) { setErr(e.message); }
  };
  const addRentalAccount = async () => {
    if (!newRental.phone || !newRental.username || !newRental.displayName) { setErr("Phone, username and display name required"); return; }
    setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/rental-pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newRental) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg("Rented account added to pool");
      setShowAddRental(false);
      setNewRental({ phone: "", username: "", displayName: "", firstName: "", session: "", pricePerDay: 1 });
      loadPool();
      setTimeout(()=>setMsg(""), 3000);
    } catch (e: any) { setErr(e.message); }
  };
  const poolAction = async (id: string, action: string, extra?: any) => {
    setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/rental-pool", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg(`Pool: ${action} done`);
      loadPool();
      setTimeout(()=>setMsg(""), 3000);
    } catch (e: any) { setErr(e.message); }
  };
  const deletePool = async (id: string) => {
    if (!confirm("Delete this pool account?")) return;
    try { const r = await fetch(`/api/admin/rental-pool?id=${id}`, { method: "DELETE" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMsg("Pool account deleted"); loadPool(); } catch (e: any) { setErr(e.message); }
  };
  const sendTgCode = async () => {
    if (!tgPhone.trim() || tgPhone.trim().replace(/\s+/g,"").length < 8) { setErr("Enter a valid phone with country code — e.g. +91 98765 43210"); return; }
    setErr(""); setMsg(""); setTgLoading(true);
    try {
      const r = await fetch("/api/telegram/send-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: tgPhone.trim() }) });
      const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error || "Failed to send code");
      setTgHash(j.phoneCodeHash || ""); setTgCode(""); setTgPwd(""); setTgStep(2); setMsg("Code sent — check Telegram app for the login code");
      setTimeout(()=>setMsg(""), 4000);
    } catch (e:any){ setErr(e.message); } finally { setTgLoading(false); }
  };
  const verifyTgAndList = async () => {
    setErr(""); setMsg(""); setTgLoading(true);
    try {
      const r = await fetch("/api/admin/rental-pool/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: tgPhone.trim(), code: tgCode.trim(), password: tgPwd, phoneCodeHash: tgHash }) });
      const j = await r.json().catch(()=>({}));
      // needPassword can come as 200 (not an error) — handle before r.ok check
      if (j.needPassword) { setTgStep(3); setMsg(j.message || "2FA password required — enter your Telegram cloud password"); return; }
      if (!r.ok) throw new Error(j.error || "Verification failed");
      setMsg(j.message || "Account auto-listed for $1 / 24h");
      setTgStep(1); setTgCode(""); setTgPwd(""); setTgHash("");
      loadPool();
    } catch (e:any){ setErr(e.message); } finally { setTgLoading(false); }
  };
  const genKeys = async () => {
    setErr(""); setMsg("");
    try { const r = await fetch("/api/admin/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: genPlan, billing: genBilling, count: genCount, note: genNote }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setMsg(`Generated ${j.keys.length} key(s)`); loadKeys(); } catch (e: any) { setErr(e.message); }
  };
  const revokeKey = async (id: string, action: string) => {
    try { const r = await fetch("/api/admin/keys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); loadKeys(); } catch (e: any) { setErr(e.message); }
  };
  const subAction = async (id: string, action: string, extra?: any) => {
    try { const r = await fetch("/api/admin/subscriptions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); loadSubs(); setMsg(`Subscription ${action} done`); setTimeout(()=>setMsg(""), 3000); } catch (e: any) { setErr(e.message); }
  };

  if (isAdmin === null) return <div className="max-w-5xl"><div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">Checking admin access...</div></div>;
  if (!isAdmin) return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white border border-red-200 rounded-2xl p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mx-auto"><ShieldCheck size={22} className="text-red-600" /></div>
        <h2 className="text-lg font-bold mt-4">Admin access required</h2>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">Your email is not authorized as admin. Set <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">ADMIN_EMAILS</code> in <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">.env.local</code> to your admin email(s), comma-separated, then restart the server.</p>
        <p className="text-xs text-slate-400 mt-3">Current: {err || "403 Forbidden"}</p>
      </div>
    </div>
  );

  const hasPerm = (p: string) => !myPerms || myPerms.includes(p) || isOwner;
  const tabs: Array<[string, any, string]> = [
    ["overview", BarChart, "Overview"],
    ["users", Users, "Users"],
    ["rentals", Server, "Rented Accounts"],
    ["keys", Key, "License Keys"],
    ["subs", CreditCard, "Subscriptions"],
    ["campaigns", Megaphone, "Campaigns"],
    ["team", UserPlus, "Team"],
    ["payments", CreditCard, "Payments"],
  ].filter(([k]) => hasPerm(k as string)) as any;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center shadow"><ShieldCheck size={18} className="text-white" /></div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Admin Panel</h1>
          <p className="text-[13px] text-slate-500">Full control — users, plans, rentals, keys & campaigns</p>
        </div>
        <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Admin</span>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {tabs.map(([k, Icon, label]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition ${tab === k ? "bg-[#229ED9] text-white border-[#229ED9] shadow" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {err && <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2"><AlertTriangle size={14} /> {err} <button onClick={()=>setErr("")} className="ml-auto text-xs font-bold">Dismiss</button></div>}
      {msg && <div className="mt-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3">{msg}</div>}

      {tab === "overview" && overview && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-bold tracking-widest text-slate-400">TOTAL USERS</div><div className="text-2xl font-extrabold mt-1">{overview.counts.users}</div><div className="text-xs text-slate-500">{overview.counts.bannedUsers} banned</div></div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-bold tracking-widest text-slate-400">CAMPAIGNS</div><div className="text-2xl font-extrabold mt-1">{overview.counts.campaigns}</div><div className="text-xs text-slate-500">{overview.counts.running} running · {overview.counts.totalSent.toLocaleString()} sent</div></div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-bold tracking-widest text-slate-400">RENTAL POOL</div><div className="text-2xl font-extrabold mt-1">{overview.counts.pool}</div><div className="text-xs text-slate-500">{overview.counts.poolAvailable} available · {overview.counts.poolRented} rented</div></div>
            <div className="bg-gradient-to-br from-violet-600 to-indigo-700 rounded-2xl p-4 text-white"><div className="text-[11px] font-bold tracking-widest text-white/70">ACTIVE SUBS</div><div className="text-2xl font-extrabold mt-1">{overview.counts.activeSubscriptions}</div><div className="text-xs text-white/70">{overview.counts.keys} keys · {overview.counts.unusedKeys} unused</div></div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold">Plan breakdown (active)</h3>
              <div className="mt-3 space-y-2">
                {Object.entries(overview.planBreakdown as Record<string,number>).length ? Object.entries(overview.planBreakdown as Record<string,number>).map(([k,v]) => (
                  <div key={k} className="flex items-center gap-2 text-sm"><span className="font-bold capitalize">{k.replace("_","+")}</span><div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-2 bg-[#229ED9] rounded-full" style={{ width: `${Math.max(8, (v / Math.max(1, overview.counts.activeSubscriptions))*100)}%` }} /></div><span className="font-bold">{v}</span></div>
                )) : <div className="text-sm text-slate-400">No active subscriptions</div>}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold">Quick actions</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={()=>setTab("users")} className="bg-[#229ED9] text-white rounded-xl py-3 text-xs font-bold">Manage Users</button>
                <button onClick={()=>setTab("rentals")} className="bg-white border border-slate-200 rounded-xl py-3 text-xs font-bold">Add Rented Account</button>
                <button onClick={()=>setTab("keys")} className="bg-white border border-slate-200 rounded-xl py-3 text-xs font-bold">Generate Keys</button>
                <button onClick={()=>setTab("campaigns")} className="bg-white border border-slate-200 rounded-xl py-3 text-xs font-bold">View Campaigns</button>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="text-sm font-bold">System</h3>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"><div className="text-[10px] font-bold tracking-widest text-slate-400">TG ACCOUNTS</div><div className="font-bold text-sm mt-1">{overview.counts.tgAccounts}</div></div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"><div className="text-[10px] font-bold tracking-widest text-slate-400">RENTALS</div><div className="font-bold text-sm mt-1">{overview.counts.rentals} ({overview.counts.activeRentals} active)</div></div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"><div className="text-[10px] font-bold tracking-widest text-slate-400">SUBSCRIPTIONS</div><div className="font-bold text-sm mt-1">{overview.counts.subscriptions}</div></div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"><div className="text-[10px] font-bold tracking-widest text-slate-400">KEYS</div><div className="font-bold text-sm mt-1">{overview.counts.keys}</div></div>
            </div>
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="mt-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input value={usersSearch} onChange={e=>setUsersSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loadUsers(1)} placeholder="Search name or email" className="w-full border border-slate-200 rounded-full pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-900/10 focus:border-[#229ED9] outline-none" /></div>
              <select value={usersFilter} onChange={e=>setUsersFilter(e.target.value)} className="border border-slate-200 rounded-full px-3 py-2.5 text-sm bg-white"><option value="all">All users</option><option value="active">Active</option><option value="banned">Banned</option></select>
              <button onClick={()=>loadUsers(1)} className="bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-xs font-bold">Search</button>
              <span className="text-xs text-slate-500">{usersTotal} users</span>
            </div>
          </div>
          <div className="mt-3 bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 py-3">USER</th><th className="px-3 py-3">PLAN</th><th className="px-3 py-3">ACCOUNTS</th><th className="px-3 py-3">CAMPAIGNS</th><th className="px-3 py-3">LAST LOGIN</th><th className="px-3 py-3">STATUS</th><th className="px-3 py-3 text-right">ACTIONS</th></tr></thead>
              <tbody>
                {users.map((u:any) => (
                  <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="font-semibold text-slate-900">{u.name}</div><div className="text-xs text-slate-500 flex items-center gap-1"><Mail size={11} />{u.email}</div>{u.telegramUsername && <div className="text-xs text-slate-400">@{u.telegramUsername}</div>}<div className="text-[11px] text-slate-400">Joined {new Date(u.createdAt).toLocaleDateString()}</div></td>
                    <td className="px-3 py-3 text-center"><span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${u.plan !== "None" ? "bg-[#229ED9] text-white border-[#229ED9]" : "bg-slate-100 text-slate-500 border-slate-200"}`}>{u.plan}</span>{u.expiresAt && <div className="text-[11px] text-slate-400 mt-1">{new Date(u.expiresAt).toLocaleDateString()}</div>}</td>
                    <td className="px-3 py-3 text-center font-bold">{u.tgAccounts}</td>
                    <td className="px-3 py-3 text-center"><span className="font-bold">{u.campaignsCount}</span><div className="text-xs text-slate-500">{u.totalSent} sent</div></td>
                    <td className="px-3 py-3 text-xs text-slate-600">{u.lastLoginAt === "Never" ? <span className="text-slate-400">Never</span> : new Date(u.lastLoginAt).toLocaleString()}</td>
                    <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${u.isBanned ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>{u.isBanned ? "BANNED" : "ACTIVE"}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {u.isBanned ? <button onClick={()=>doUserAction(u.id,"unban")} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-full">Unban</button> : <button onClick={()=>doUserAction(u.id,"ban")} className="text-xs font-bold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-full">Ban</button>}
                        <button onClick={()=>{ const p = prompt("New password (min 6 chars):"); if(p) doUserAction(u.id,"reset_password",{newPassword:p}); }} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Reset PW</button>
                        <button onClick={()=>deleteUser(u.id)} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-full">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!users.length && !loading && <div className="p-8 text-center text-sm text-slate-400">No users found</div>}
            {loading && <div className="p-8 text-center text-sm text-slate-400">Loading...</div>}
          </div>
          {usersTotal > 20 && (
            <div className="mt-3 flex gap-2 justify-center">
              <button disabled={usersPage<=1} onClick={()=>loadUsers(usersPage-1)} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40">Prev</button>
              <span className="text-xs text-slate-500 py-2">Page {usersPage} of {Math.ceil(usersTotal/20)}</span>
              <button disabled={usersPage>=Math.ceil(usersTotal/20)} onClick={()=>loadUsers(usersPage+1)} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40">Next</button>
            </div>
          )}
        </div>
      )}

      {tab === "rentals" && (
        <div className="mt-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-2 items-center justify-between">
            <div><h3 className="text-sm font-bold">Rented Accounts Pool — $1 / 24h</h3><p className="text-xs text-slate-500">Telegram phone → OTP → 2FA → auto-listed. Buyers rent in 1 click.</p></div>
            <button onClick={()=>setShowAddRental(!showAddRental)} className="bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-xs font-bold flex items-center gap-1.5"><Plus size={14} /> {showAddRental ? "Close" : "Add Manually"}</button>
          </div>
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">📱</div><h4 className="text-sm font-bold">Add Telegram account — auto-listed for $1 / 24h</h4><span className="ml-auto text-[10px] font-bold tracking-widest bg-white text-slate-900 px-2 py-1 rounded-full">$1 / 24H</span></div>
            <p className="text-xs text-white/60 mt-1">Enter number → OTP → 2FA (if needed) → account is automatically added to rental pool. Users buy in 1 click.</p>
            <div className="flex gap-1.5 mt-3">{[1,2,3].map(n=> <div key={n} className={`flex-1 h-1.5 rounded-full ${n<=tgStep?'bg-white':'bg-white/20'}`} />)}</div>
            {tgStep===1 && <div className="mt-4 flex gap-2"><input value={tgPhone} onChange={e=>setTgPhone(e.target.value)} placeholder="+91 98765 43210" className="flex-1 bg-white text-slate-900 rounded-xl px-3.5 py-3 text-sm outline-none" /><button onClick={sendTgCode} disabled={tgLoading} className="bg-white text-slate-900 px-6 py-3 rounded-full text-sm font-bold disabled:opacity-50">{tgLoading?"Sending…":"Send Code"}</button></div>}
            {tgStep===2 && <div className="mt-4 space-y-2"><input value={tgCode} onChange={e=>setTgCode(e.target.value)} placeholder="OTP from Telegram" className="w-full bg-white text-slate-900 rounded-xl px-3.5 py-3 text-sm outline-none" /><div className="flex gap-2"><button onClick={verifyTgAndList} disabled={tgLoading || !tgCode.trim()} className="flex-1 bg-white text-slate-900 py-3 rounded-full text-sm font-bold disabled:opacity-50">{tgLoading?"Verifying…":"Verify & Auto-List ($1/24h)"}</button><button onClick={()=>{setTgStep(1); setTgCode("");}} className="px-4 py-3 rounded-full text-xs font-bold bg-white/10 border border-white/20">Back</button></div><button onClick={sendTgCode} disabled={tgLoading} className="text-xs text-white/60 underline">Resend code</button></div>}
            {tgStep===3 && <div className="mt-4 space-y-2"><div className="text-xs font-bold text-amber-300">2FA password required — enter your Telegram cloud password</div><input value={tgPwd} onChange={e=>setTgPwd(e.target.value)} type="password" placeholder="Telegram 2FA password" className="w-full bg-white text-slate-900 rounded-xl px-3.5 py-3 text-sm outline-none" /><div className="flex gap-2"><button onClick={verifyTgAndList} disabled={tgLoading || !tgPwd.trim()} className="flex-1 bg-white text-slate-900 py-3 rounded-full text-sm font-bold disabled:opacity-50">{tgLoading?"Checking…":"Complete & List"}</button><button onClick={()=>{setTgStep(2); setTgPwd("");}} className="px-4 py-3 rounded-full text-xs font-bold bg-white/10 border border-white/20">Back</button></div></div>}
          </div>
          {showAddRental && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h4 className="text-sm font-bold">Add rented account to pool</h4>
              <div className="grid md:grid-cols-2 gap-3">
                <input value={newRental.phone} onChange={e=>setNewRental({...newRental, phone:e.target.value})} placeholder="Phone — e.g. +91 90000 00007" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-[#229ED9]" />
                <input value={newRental.username} onChange={e=>setNewRental({...newRental, username:e.target.value})} placeholder="Username — e.g. sender_hub_07" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-[#229ED9]" />
                <input value={newRental.displayName} onChange={e=>setNewRental({...newRental, displayName:e.target.value})} placeholder="Display name — e.g. Sender Hub 07" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-[#229ED9]" />
                <input value={newRental.firstName} onChange={e=>setNewRental({...newRental, firstName:e.target.value})} placeholder="First name — e.g. Sender" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-[#229ED9]" />
                <input value={newRental.session} onChange={e=>setNewRental({...newRental, session:e.target.value})} placeholder="Telegram session string (optional — auto if empty)" className="border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-[#229ED9] md:col-span-2" />
                <label className="flex items-center gap-2 text-sm">Price/day <input type="number" value={newRental.pricePerDay} onChange={e=>setNewRental({...newRental, pricePerDay: parseInt(e.target.value)||1})} className="border border-slate-200 rounded-full px-3 py-1.5 text-sm w-24" /> $</label>
              </div>
              <button onClick={addRentalAccount} className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-2.5 rounded-full text-sm font-bold">Add to Pool</button>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 py-3">ACCOUNT</th><th className="px-3 py-3">STATUS</th><th className="px-3 py-3">PRICE</th><th className="px-3 py-3">RENTED BY</th><th className="px-3 py-3 text-right">ACTIONS</th></tr></thead>
              <tbody>
                {pool.map((p:any) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="font-semibold">{p.displayName}</div><div className="text-xs text-slate-500">@{p.username} · {p.phone}</div><div className="text-[11px] text-slate-400">Added {new Date(p.createdAt).toLocaleDateString()}</div></td>
                    <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${p.status==="available" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : p.status==="rented" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-red-50 text-red-700 border-red-200"}`}>{p.status.toUpperCase()}</span></td>
                    <td className="px-3 py-3 text-center font-bold">${p.pricePerDay}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{p.status==="rented" ? (p.expiresAt ? `Till ${new Date(p.expiresAt).toLocaleString()}` : "Rented") : "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {p.status==="rented" && <button onClick={()=>poolAction(p.id,"force_free")} className="text-xs font-bold bg-amber-500 text-white px-3 py-1.5 rounded-full">Force Free</button>}
                        {p.status==="available" && <button onClick={()=>poolAction(p.id,"ban")} className="text-xs font-bold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-full">Ban</button>}
                        {p.status==="banned" && <button onClick={()=>poolAction(p.id,"unban")} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-full">Unban</button>}
                        <button onClick={()=>deletePool(p.id)} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-full">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!pool.length && !loading && <div className="p-8 text-center text-sm text-slate-400">No pool accounts — add one above</div>}
            {loading && <div className="p-8 text-center text-sm text-slate-400">Loading...</div>}
          </div>
        </div>
      )}

      {tab === "keys" && (
        <div className="mt-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="text-sm font-bold flex items-center gap-2"><Key size={16} /> Generate License Keys</h3>
            <div className="mt-3 flex flex-wrap gap-2 items-end">
              <label className="text-xs font-semibold">Plan <select value={genPlan} onChange={e=>setGenPlan(e.target.value)} className="ml-1 border border-slate-200 rounded-full px-3 py-1.5 text-sm bg-white"><option value="elite">Elite</option><option value="pro">Pro</option><option value="max_plus">Max+</option><option value="luxe">Luxe</option></select></label>
              <label className="text-xs font-semibold">Billing <select value={genBilling} onChange={e=>setGenBilling(e.target.value as any)} className="ml-1 border border-slate-200 rounded-full px-3 py-1.5 text-sm bg-white"><option value="daily">Daily</option><option value="monthly">Monthly</option></select></label>
              <label className="text-xs font-semibold">Count <input type="number" min={1} max={100} value={genCount} onChange={e=>setGenCount(Math.max(1,Math.min(100,parseInt(e.target.value)||1)))} className="ml-1 border border-slate-200 rounded-full px-3 py-1.5 text-sm w-20" /></label>
              <input value={genNote} onChange={e=>setGenNote(e.target.value)} placeholder="Note (e.g. payment id)" className="flex-1 min-w-[160px] border border-slate-200 rounded-full px-3 py-1.5 text-sm" />
              <button onClick={genKeys} className="bg-[#229ED9] text-white px-5 py-2 rounded-full text-sm font-bold">Generate</button>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0"><tr><th className="text-left px-3 py-2">CODE</th><th className="px-2 py-2">PLAN</th><th className="px-2 py-2">BILLING</th><th className="px-2 py-2">STATUS</th><th className="px-2 py-2">USED BY</th><th className="px-2 py-2">ACTION</th></tr></thead>
                <tbody>
                  {keys.map((k:any) => (
                    <tr key={k.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono font-semibold flex items-center gap-1">{k.code} <button onClick={()=>{ navigator.clipboard.writeText(k.code); setMsg("Copied "+k.code); setTimeout(()=>setMsg(""),2000); }} className="text-slate-400 hover:text-slate-900"><Copy size={12} /></button></td>
                      <td className="px-2 py-2">{k.planId}</td>
                      <td className="px-2 py-2">{k.billing}</td>
                      <td className="px-2 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${k.status==="unused" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : k.status==="used" ? "bg-slate-100 text-slate-600 border-slate-200" : "bg-red-50 text-red-700 border-red-200"}`}>{k.status}</span></td>
                      <td className="px-2 py-2 truncate max-w-[120px]">{k.usedBy || "—"}</td>
                      <td className="px-2 py-2">{k.status==="unused" ? <button onClick={()=>revokeKey(k.id,"revoke")} className="text-red-600 font-bold">Revoke</button> : k.status==="revoked" ? <button onClick={()=>revokeKey(k.id,"unrevoke")} className="text-emerald-600 font-bold">Restore</button> : <span className="text-slate-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!keys.length && !loading && <div className="p-6 text-center text-sm text-slate-400">No keys yet</div>}
              {loading && <div className="p-6 text-center text-sm text-slate-400">Loading...</div>}
            </div>
          </div>
        </div>
      )}

      {tab === "subs" && (
        <div className="mt-4">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 py-3">USER</th><th className="px-3 py-3">PLAN</th><th className="px-3 py-3">BILLING</th><th className="px-3 py-3">STATUS</th><th className="px-3 py-3">EXPIRES</th><th className="px-3 py-3 text-right">ACTIONS</th></tr></thead>
              <tbody>
                {subs.map((s:any) => (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="font-semibold">{s.userName}</div><div className="text-xs text-slate-500">{s.userEmail}</div></td>
                    <td className="px-3 py-3 text-center"><span className="text-xs font-bold bg-[#229ED9] text-white px-2.5 py-1 rounded-full">{s.planName}</span></td>
                    <td className="px-3 py-3 text-center text-xs font-semibold capitalize">{s.billing}</td>
                    <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${s.status==="active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : s.status==="expired" ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-red-50 text-red-700 border-red-200"}`}>{s.status.toUpperCase()}</span></td>
                    <td className="px-3 py-3 text-xs">{new Date(s.expiresAt).toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 justify-end">
                        {s.status==="active" && <button onClick={()=>subAction(s.id,"revoke")} className="text-xs font-bold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-full">Revoke</button>}
                        <button onClick={()=>{ const d = prompt("Extend by how many days?", "30"); if(d) subAction(s.id,"extend",{days: parseInt(d)}); }} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Extend</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!subs.length && !loading && <div className="p-8 text-center text-sm text-slate-400">No subscriptions</div>}
            {loading && <div className="p-8 text-center text-sm text-slate-400">Loading...</div>}
          </div>
        </div>
      )}

      {tab === "campaigns" && (
        <div className="mt-4">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 py-3">CAMPAIGN</th><th className="px-3 py-3">USER</th><th className="px-3 py-3">STATUS</th><th className="px-3 py-3">RESULT</th><th className="px-3 py-3">CREATED</th></tr></thead>
              <tbody>
                {campaigns.map((c:any) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="font-semibold">{c.name}</div><div className="text-xs text-slate-500">{c.destinations?.length || 0} destinations</div></td>
                    <td className="px-3 py-3"><div className="text-xs font-semibold">{c.userName}</div><div className="text-xs text-slate-500">{c.userEmail}</div></td>
                    <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${c.status==="Completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : c.status==="Repeating" ? "bg-blue-50 text-blue-700 border-[#BFDBFE]" : c.status==="Failed" ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>{c.status}</span></td>
                    <td className="px-3 py-3 text-center"><span className="font-bold">{c.successful}/{c.destinations?.length || 0}</span></td>
                    <td className="px-3 py-3 text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!campaigns.length && !loading && <div className="p-8 text-center text-sm text-slate-400">No campaigns</div>}
            {loading && <div className="p-8 text-center text-sm text-slate-400">Loading...</div>}
          </div>
        </div>
      )}

      {tab === "team" && (
        <div className="mt-4 space-y-4">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><UserPlus size={18} /></div>
              <div>
                <h3 className="text-sm font-bold">Invite team member by email</h3>
                <p className="text-xs text-white/60">They get access only to what you tick — not everything. Owner keeps full access.</p>
              </div>
              <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest bg-white text-slate-900 px-2.5 py-1 rounded-full"><Shield size={12} /> SCOPED</span>
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-3">
              <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="Email — e.g. teammate@company.com" className="bg-white text-slate-900 rounded-xl px-3.5 py-3 text-sm outline-none placeholder:text-slate-400" />
              <input value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Name (optional)" className="bg-white text-slate-900 rounded-xl px-3.5 py-3 text-sm outline-none placeholder:text-slate-400" />
            </div>
            <div className="mt-3">
              <div className="text-[11px] font-bold tracking-widest text-white/60 mb-2">PERMISSIONS — tick only what they need</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(PERM_LABELS).filter(([k])=>k!=="team" || isOwner).map(([k, v]) => {
                  const checked = invitePerms.includes(k);
                  return (
                    <label key={k} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border cursor-pointer transition ${checked ? "bg-white text-slate-900 border-white" : "bg-white/10 text-white border-white/20 hover:bg-white/15"}`}>
                      <input type="checkbox" checked={checked} onChange={e=> setInvitePerms(e.target.checked ? [...invitePerms, k] : invitePerms.filter(x=>x!==k))} className="mt-0.5 accent-slate-900" />
                      <span className="min-w-0"><span className="text-xs font-bold block leading-none">{v.label}</span><span className={`text-[11px] leading-tight block mt-1 ${checked ? "text-slate-500" : "text-white/60"}`}>{v.desc}</span></span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={()=>setInvitePerms(Object.keys(PERM_LABELS).filter(k=>k!=="team" || isOwner))} className="text-xs font-bold bg-white/10 border border-white/20 px-3 py-1.5 rounded-full">Select all</button>
                <button onClick={()=>setInvitePerms(["overview"])} className="text-xs font-bold bg-white/10 border border-white/20 px-3 py-1.5 rounded-full">Clear</button>
              </div>
            </div>
            <button onClick={inviteTeam} className="mt-4 w-full md:w-auto bg-white text-slate-900 px-6 py-3 rounded-full text-sm font-bold shadow flex items-center justify-center gap-2"><UserPlus size={16} /> Invite — scoped access</button>
            <p className="text-[11px] text-white/50 mt-2">If the email already has an account, they get instant access. Otherwise they&apos;ll be pending until they sign up with that email.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2"><Settings2 size={16} /> Team members</h3>
              <span className="text-xs text-slate-500">{team.length} member(s)</span>
            </div>
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 py-3">MEMBER</th><th className="px-3 py-3">ROLE</th><th className="px-3 py-3">PERMISSIONS</th><th className="px-3 py-3">STATUS</th><th className="px-3 py-3 text-right">ACTIONS</th></tr></thead>
              <tbody>
                {team.map((m:any) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="font-semibold text-slate-900">{m.name || m.email.split("@")[0]}</div><div className="text-xs text-slate-500 flex items-center gap-1"><Mail size={11} />{m.email}</div><div className="text-[11px] text-slate-400">Added {new Date(m.createdAt).toLocaleDateString()}</div></td>
                    <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${m.role==="pending" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-[#229ED9] text-white border-[#229ED9]"}`}>{m.role.toUpperCase()}</span></td>
                    <td className="px-3 py-3">
                      {editingPerms===m.id ? (
                        <div className="space-y-2 min-w-[260px]">
                          <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(PERM_LABELS).map(([k, v]) => (
                              <label key={k} className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-full border cursor-pointer ${editPerms.includes(k) ? "bg-[#229ED9] text-white border-[#229ED9]" : "bg-white border-slate-200"}`}>
                                <input type="checkbox" checked={editPerms.includes(k)} onChange={e=> setEditPerms(e.target.checked ? [...editPerms, k] : editPerms.filter(x=>x!==k))} className="accent-slate-900" /> {v.label}
                              </label>
                            ))}
                          </div>
                          <div className="flex gap-1">
                            <button onClick={async()=>{ await teamAction(m.id,"update_perms",{permissions: editPerms}); setEditingPerms(null); }} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1"><Check size={12} /> Save</button>
                            <button onClick={()=>setEditingPerms(null)} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[320px]">
                          {(m.permissions||[]).map((p:string)=><span key={p} className="text-[10px] font-bold tracking-widest bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full">{PERM_LABELS[p]?.label || p}</span>)}
                          {!m.permissions?.length && <span className="text-xs text-slate-400">—</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${m.status==="active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>{m.status.toUpperCase()}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {editingPerms!==m.id && <button onClick={()=>{ setEditingPerms(m.id); setEditPerms([...(m.permissions||[])]) }} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1"><Settings2 size={12} /> Edit access</button>}
                        {m.status==="active" ? <button onClick={()=>teamAction(m.id,"revoke")} className="text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full flex items-center gap-1"><XIcon size={12} /> Revoke</button> : <button onClick={()=>teamAction(m.id,"reinstate")} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1"><Check size={12} /> Restore</button>}
                        <button onClick={()=>deleteTeam(m.id)} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-full flex items-center gap-1"><Trash2 size={12} /> Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!team.length && !loading && <div className="p-8 text-center text-sm text-slate-400">No team members yet — invite one above. Only ticked permissions are granted.</div>}
            {loading && <div className="p-8 text-center text-sm text-slate-400">Loading...</div>}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="text-xs font-bold tracking-widest text-amber-800">HOW IT WORKS</div>
            <ul className="mt-2 text-xs text-amber-900/80 leading-6 list-disc list-inside">
              <li>Owner (ADMIN_EMAILS) always has full access — can&apos;t be scoped.</li>
              <li>Team members only see tabs you ticked — e.g. tick <b>Rentals + Keys</b> and they can create rentals/keys but not touch Users or Subscriptions.</li>
              <li>Revoke instantly removes access; Remove deletes the invite.</li>
              <li>To give full admin, tick all permissions.</li>
            </ul>
          </div>
        </div>
      )}

      {tab === "payments" && (
        <div className="mt-4 space-y-4">
          {paymentsSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-bold tracking-widest text-slate-400">TOTAL PAYMENTS</div><div className="text-2xl font-extrabold mt-1">{paymentsSummary.total}</div><div className="text-xs text-slate-500">{paymentsSummary.finished + paymentsSummary.confirmed} paid · {paymentsSummary.waiting} waiting</div></div>
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white"><div className="text-[11px] font-bold tracking-widest text-white/70">REVENUE (PAID)</div><div className="text-2xl font-extrabold mt-1">${paymentsSummary.revenueUsd}</div><div className="text-xs text-white/70">{paymentsSummary.finished + paymentsSummary.confirmed} orders</div></div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4"><div className="text-[11px] font-bold tracking-widest text-amber-700">PENDING REVENUE</div><div className="text-2xl font-extrabold mt-1 text-amber-700">${paymentsSummary.pendingRevenueUsd}</div><div className="text-xs text-amber-600">{paymentsSummary.waiting} waiting</div></div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="text-[11px] font-bold tracking-widest text-slate-400">FAILED / EXPIRED</div><div className="text-2xl font-extrabold mt-1">{paymentsSummary.failed + paymentsSummary.expired}</div><div className="text-xs text-slate-500">{paymentsSummary.failed} failed · {paymentsSummary.expired} expired</div></div>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input value={paymentsSearch} onChange={e=>setPaymentsSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loadPayments(1)} placeholder="Search order, email, plan, key, amount" className="w-full border border-slate-200 rounded-full pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-slate-900/10 focus:border-[#229ED9] outline-none" /></div>
              <select value={paymentsFilter} onChange={e=>setPaymentsFilter(e.target.value)} className="border border-slate-200 rounded-full px-3 py-2.5 text-sm bg-white">
                <option value="all">All status</option>
                <option value="waiting">Waiting</option>
                <option value="confirming">Confirming</option>
                <option value="confirmed">Confirmed</option>
                <option value="finished">Finished</option>
                <option value="failed">Failed</option>
                <option value="expired">Expired</option>
              </select>
              <button onClick={()=>loadPayments(1)} className="bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-xs font-bold">Search</button>
              <span className="text-xs text-slate-500">{paymentsTotal} payments</span>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500"><tr><th className="text-left px-4 py-3">USER</th><th className="px-3 py-3">PLAN</th><th className="px-3 py-3">AMOUNT</th><th className="px-3 py-3">STATUS</th><th className="px-3 py-3">API KEY</th><th className="px-3 py-3">DATE</th><th className="px-3 py-3">INVOICE</th><th className="px-3 py-3 text-right">ACTIONS</th></tr></thead>
              <tbody>
                {payments.map((p:any) => (
                  <tr key={p.orderId} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="font-semibold text-slate-900">{p.userName}</div><div className="text-xs text-slate-500 flex items-center gap-1"><Mail size={11} />{p.userEmail}</div><div className="text-[11px] text-slate-400 font-mono">{p.orderId}</div></td>
                    <td className="px-3 py-3 text-center"><span className="text-xs font-bold bg-[#229ED9] text-white px-2.5 py-1 rounded-full">{p.planName}</span><div className="text-[11px] text-slate-500 mt-1 capitalize">{p.billing} · {p.payCurrency ? p.payCurrency.toUpperCase() : "—"}</div></td>
                    <td className="px-3 py-3 text-center"><span className="font-bold">${p.amountUsd}</span><div className="text-[11px] text-slate-400">{p.priceCurrency?.toUpperCase() || "USD"}</div></td>
                    <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${p.status==="finished" ? "bg-emerald-600 text-white border-emerald-600" : p.status==="confirmed" ? "bg-blue-600 text-white border-blue-600" : p.status==="waiting" || p.status==="confirming" ? "bg-amber-100 text-amber-700 border-amber-200" : p.status==="failed" || p.status==="expired" ? "bg-red-100 text-red-700 border-red-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>{p.status.toUpperCase()}</span></td>
                    <td className="px-3 py-3"><div className="font-mono text-xs font-semibold flex items-center gap-1">{p.licenseKey ? <><span className="text-emerald-700">{p.licenseKey}</span><button onClick={()=>{ navigator.clipboard.writeText(p.licenseKey); setMsg("Copied "+p.licenseKey); setTimeout(()=>setMsg(""),2000); }} className="text-slate-400 hover:text-slate-900"><Copy size={12} /></button></> : <span className="text-slate-400">—</span>}</div>{p.licenseKey && <div className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full inline-block mt-1">AUTO-ACTIVATED</div>}</td>
                    <td className="px-3 py-3 text-xs text-slate-600"><div>{new Date(p.createdAt).toLocaleDateString()}</div><div className="text-[11px] text-slate-400">{new Date(p.createdAt).toLocaleTimeString()}</div><div className="text-[11px] text-slate-400">{p.invoiceId ? `#${p.invoiceId}` : ""}</div></td>
                    <td className="px-3 py-3 text-center">{p.invoiceUrl ? <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full hover:bg-slate-50">Open →</a> : <span className="text-xs text-slate-400">—</span>}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {!p.licenseKey && p.status==="waiting" && <button onClick={()=>paymentAction(p.orderId,"verify")} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full hover:bg-slate-50">Verify</button>}
                        {!p.licenseKey && <button onClick={()=>{ if(confirm(`Confirm payment for ${p.userEmail} — ${p.planName} ${p.billing} $${p.amountUsd}? This will generate API key & activate plan.`)) paymentAction(p.orderId,"confirm"); }} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-full hover:bg-emerald-700">Confirm & Activate</button>}
                        {!p.licenseKey && p.status!=="failed" && p.status!=="expired" && <button onClick={()=>paymentAction(p.orderId,"mark_failed")} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-full">Mark Failed</button>}
                        {p.licenseKey && <span className="text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full">Active ✓</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!payments.length && !loading && <div className="p-8 text-center text-sm text-slate-400">No payments found</div>}
            {loading && <div className="p-8 text-center text-sm text-slate-400">Loading...</div>}
          </div>
          {paymentsTotal > 20 && (
            <div className="flex gap-2 justify-center">
              <button disabled={paymentsPage<=1} onClick={()=>loadPayments(paymentsPage-1)} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40">Prev</button>
              <span className="text-xs text-slate-500 py-2">Page {paymentsPage} of {Math.ceil(paymentsTotal/20)}</span>
              <button disabled={paymentsPage>=Math.ceil(paymentsTotal/20)} onClick={()=>loadPayments(paymentsPage+1)} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40">Next</button>
            </div>
          )}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="text-xs font-bold tracking-widest text-amber-800">HOW PAYMENTS WORK</div>
            <ul className="mt-2 text-xs text-amber-900/80 leading-6 list-disc list-inside">
              <li><b>Verify</b> — tries to check with NOWPayments directly (works when paymentId exists from IPN).</li>
              <li><b>Confirm & Activate</b> — admin manually confirms payment → instantly generates <b>API key (license key)</b> + activates subscription (daily 24h / monthly 30d). Use when user paid but webhook never arrived (localhost) or NOWPayments is slow.</li>
              <li>On production with public <code className="bg-white px-1 rounded border">NEXT_PUBLIC_APP_URL</code>, webhook auto-activates — no manual step needed.</li>
              <li>Support: <a href="https://t.me/princerana" target="_blank" className="text-[#229ED9] font-bold underline">@princerana</a></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
