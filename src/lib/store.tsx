"use client";
import React, {createContext, useContext, useState, useEffect} from "react";
export type Dest = {id:string,title:string,type:"Group"|"Channel",members:number,allowed:boolean,lastUsed:string};
export type Campaign = {id:string,name:string,destinations:string[],message:string,status:"Draft"|"Running"|"Completed"|"Paused"|"Failed"|"Repeating"|"Scheduled",successful:number,failed:number,createdAt:string,logs:{dest:string,status:string,time:string,error?:string}[]}&Record<string,any>;
export type Template = {id:string,name:string,message:string,category:string};
export type TgAccountInfo = {id:string,phone:string,username:string,displayName:string,firstName:string,status:string,createdAt:string};
type Store = {
  lang:"en"|"ru"; setLang:(l:"en"|"ru")=>void;
  user:{name:string,email:string}|null; setUser:(u:any)=>void;
  tg:{username:string,phone:string,connected:boolean}|null; setTg:(t:any)=>void;
  tgAccounts:TgAccountInfo[]; activeTgId:string|null; setTgAccounts:(a:TgAccountInfo[])=>void; setActiveTgId:(id:string|null)=>void;
  refreshTgAccounts:()=>Promise<void>;
  dests:Dest[]; setDests:(d:Dest[])=>void;
  campaigns:Campaign[]; setCampaigns:(c:Campaign[])=>void;
  templates:Template[]; setTemplates:(t:Template[])=>void;
  addCampaign:(c:Campaign)=>void;
  view:string; setView:(v:string)=>void;
  refreshDests:()=>Promise<void>; destsLoading:boolean;
};
const Ctx = createContext<Store>(null as any);
export const useStore = ()=>useContext(Ctx);
export function StoreProvider({children}:{children:React.ReactNode}){
  const [user,setUser]=useState<any>(null);
  const [tg,setTg]=useState<any>(null);
  const [tgAccounts,setTgAccounts]=useState<TgAccountInfo[]>([]);
  const [activeTgId,setActiveTgId]=useState<string|null>(null);
  const [dests,setDests]=useState<Dest[]>([]);
  const [destsLoading,setDestsLoading]=useState(false);
  const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [templates,setTemplates]=useState<Template[]>([]);
  const [view,setView]=useState("landing");
  const [lang,setLangState]=useState<"en"|"ru">("en");
  const [hydrated,setHydrated]=useState(false);
  const setLang=(l:"en"|"ru")=>{ setLangState(l); try{localStorage.setItem("yosender_lang",l);}catch{} };
  const refreshTgAccounts = async()=>{
    try{
      const r=await fetch("/api/telegram/accounts"); const j=await r.json().catch(()=>({}));
      // Not logged in (email): never show any Telegram identity — clear
      // everything so the sidebar can't keep a ghost avatar+name.
      if(r.status===401){ setTgAccounts([]); setTg(null); setActiveTgId(null); setDests([]); return; }
      if(r.ok && j.accounts){
        let list = j.accounts as TgAccountInfo[];
        // Session-hidden rentals (X button on an active rental) stay hidden
        // until their 24h expiry passes — hiding is per-browser, server keeps
        // the row so the rental survives logout/login on any device.
        try {
          const hidden: string[] = JSON.parse(localStorage.getItem("yosender_hidden_rentals") || "[]");
          if (Array.isArray(hidden) && hidden.length) {
            const now = Date.now();
            list = list.filter((a: any) => {
              if (!hidden.includes(String(a.id))) return true;
              // Expired (or non-rental) rows: unhide automatically.
              if (!(a as any).isRental) return true;
              const exp = new Date((a as any).rentalExpiresAt || 0).getTime();
              return !(exp && exp > now);
            });
          }
        } catch {}
        setTgAccounts(list);
        // Always sync activeId (even null) — keeping a stale id would make
        // the sidebar fall back to tgAccounts[0] and show the wrong account.
        setActiveTgId(j.activeId ?? (list[0]?.id ?? null));
        // No accounts left: never keep a ghost Telegram identity.
        if(!list.length){ setTg(null); setActiveTgId(null); setDests([]); }
      }
    }catch{}
  };
  useEffect(()=>{
    try{const l=localStorage.getItem("yosender_lang"); if(l==="ru"||l==="en")setLangState(l);}catch{}
    const s=localStorage.getItem("tgm_store");
    if(s){try{const p=JSON.parse(s); if(p.user)setUser(p.user); if(p.view && p.view!=="connect")setView(p.view);}catch{}}
    // Never restore tg identity from localStorage — the cookie-backed server is
    // the only source of truth, otherwise logged-out sessions keep showing the
    // old avatar + name after every refresh (ghost-account bug).
    setTg(null);
    fetch("/api/auth/me").then(r=>r.json()).then(j=>{ if(j.user) setUser(j.user); }).catch(()=>{});
    fetch("/api/telegram/me").then(r=>r.json()).then(j=>{ if(j.connected) setTg({username:j.username,phone:j.phone,connected:true, displayName: [j.firstName,j.lastName].filter(Boolean).join(" ")||j.username, firstName:j.firstName}); else setTg(null); }).catch(()=>{ setTg(null); });
    refreshTgAccounts();
    // Templates are server-persisted (per user) — load once on boot so they
    // survive refresh. setTemplates here is load-only; saves go through the
    // /api/templates helpers below.
    fetch("/api/templates").then(r=>r.json()).then(j=>{ if(Array.isArray(j.templates)) setTemplates(j.templates); }).catch(()=>{});
    fetch("/api/campaigns").then(r=>r.json()).then(j=>{ if(j.campaigns) {
      // dedupe by id — keeps first occurrence, drops duplicates (can happen from Date.now() collisions)
      const seen = new Set<string>(); const unique: any[] = [];
      for (const c of j.campaigns as any[]) { if (!seen.has(String(c.id))) { seen.add(String(c.id)); unique.push(c); } }
      setCampaigns(unique.map((c:any)=>{
      // Normalize: one malformed row (missing destinations/logs) must never
      // throw during render — a render throw unmounts the whole tree and
      // EVERY button on screen goes dead until the bad row is gone.
      const destsList = Array.isArray(c.destinations) ? c.destinations : [];
      const logs = Array.isArray(c.logs) ? c.logs : [];
      let status=c.status || "Draft", successful=Number(c.successful)||0, failed=Number(c.failed)||0;
      if(logs.length){
        const ok=logs.filter((l:any)=>l.status==="Sent").length;
        if(c.status==="Running" && logs.length>=destsList.length){
          status = ok>0 || destsList.length===0 ? "Completed" : "Failed";
          successful=ok; failed=logs.length-ok;
          fetch("/api/campaigns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({patchId:c.id,patch:{status,successful,failed}})}).catch(()=>{});
        } else if(logs.length) { successful=ok; failed=logs.length-ok; }
      } else if(c.status==="Running"){
        // Give long campaigns room: 65 destinations need ~2-3 min server-side.
        // Only mark stale after 15 min, and only when NO server progress exists.
        const ageMs = Date.now() - new Date(c.createdAt).getTime();
        if(ageMs > 15*60*1000){
          status="Failed"; failed=destsList.length; successful=0;
          fetch("/api/campaigns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({patchId:c.id,patch:{status,failed,successful,logs:[...destsList.map((d:string)=>({dest:d,status:"Failed",time:new Date(c.createdAt).toLocaleString(),error:"Send did not complete"}) )]}})}).catch(()=>{});
        }
      }
      let createdAt: string;
      try { createdAt = c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"; } catch { createdAt = String(c.createdAt ?? "—"); }
      return {id:c.id,name:c.name||"Untitled",destinations:destsList,message:c.message||"",status,successful,failed,createdAt,logs,repeatIntervalId:c.repeatIntervalId,repeatEveryMins:c.repeatEveryMins,delayMins:c.delayMins,scheduledAt:c.scheduledAt,imagePreview:c.imagePreview,accountId:c.accountId};
    })); } }).catch(()=>{});
    setHydrated(true);
  },[]);
  useEffect(()=>{ if(!hydrated) return; localStorage.setItem("tgm_store",JSON.stringify({user,tg,view}));},[user,tg,view,hydrated]);
  // Live ref so refreshDests (called from click handlers + effects) always
  // sees the CURRENT activeTgId instead of the stale closure value from when
  // the callback was created. Without this, Create-Campaign's Refresh button
  // re-fetched the PREVIOUS account's groups (or none) — the "no groups while
  // creating campaign" bug — while Groups & Joiner showed the right list.
  const activeTgIdRef = React.useRef<string|null>(null);
  activeTgIdRef.current = activeTgId;
  const refreshDests = async(overrideId?: string|null)=>{
    setDestsLoading(true);
    try{
      // Use the active account so groups match the selected session.
      // overrideId lets the account-switch effect fetch the NEW account's
      // groups immediately instead of the stale closure's previous id.
      const aid = overrideId !== undefined ? overrideId : activeTgIdRef.current;
      const qs = aid ? `?accountId=${encodeURIComponent(aid)}` : "";
      const r=await fetch("/api/telegram/dialogs" + qs); const j=await r.json();
      if(!r.ok){
        // 401 = session gone: clear so Create Campaign shows empty, not stale.
        if(r.status===401){ setDests([]); }
        else if(r.status===404){ try{ await refreshTgAccounts(); }catch{} setDests([]); }
        else {
          // Any other server failure (Telegram TIMEOUT etc): clear stale dests
          // so the user sees "No groups" + can retry, instead of a frozen list
          // from another account. Error text goes to console, not a crash.
          setDests([]);
          try { console.warn("refreshDests failed:", j?.error || r.status); } catch {}
        }
      }
      else if(j.dialogs) {
      const onlyGroups = (j.dialogs as any[]).filter((d:any)=> d.type==="Group");
      setDests(onlyGroups.length ? onlyGroups : j.dialogs);
      // if API returned empty array, clear stale dests
      if(!j.dialogs.length) setDests([]);
      // Harvest every visible group into the Browse catalog (names + counts).
      // Fire-and-forget: the dialogs are already in hand, collection happens
      // server-side via saved sessions — never blocks the UI.
      fetch("/api/groups/harvest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(()=>{});
    } }catch{}
    setDestsLoading(false);
  };
  // tg (sidebar identity) derives ONLY from the account list — never fall back
  // to tgAccounts[0] when activeTgId is set but missing (that showed the wrong
  // account), and clear tg when there is no matching account at all.
  // Expired rentals are filtered out here too: the server may still carry the
  // row briefly, but the UI must never show a dead rental as connected.
  const visibleAccounts = tgAccounts.filter((a:any)=>{
    if(!(a as any).isRental) return true;
    const exp = new Date((a as any).rentalExpiresAt || 0).getTime();
    return exp && exp > Date.now();
  });
  const prevActiveRef = React.useRef<string|null>(null);
  useEffect(()=>{
    if(!visibleAccounts.length){ setTg(null); setDests([]); prevActiveRef.current = null; return; }
    const active = activeTgId ? visibleAccounts.find(a=>a.id===activeTgId) : visibleAccounts[0];
    if(!active){
      // Active id points at an expired/removed rental → fall to the first live
      // account and persist it, so the sidebar never shows a ghost identity
      // and the old logged-in account never resurfaces by accident.
      const fallback = visibleAccounts[0];
      setTg({username:fallback.username, phone:fallback.phone, connected:true, displayName: fallback.displayName, firstName: fallback.firstName});
      setActiveTgId(fallback.id);
      try{ fetch("/api/telegram/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:fallback.id})}).catch(()=>{}); }catch{}
      setDests([]); refreshDests(fallback.id);
      prevActiveRef.current = fallback.id;
      return;
    }
    setTg({username:active.username, phone:active.phone, connected:true, displayName: active.displayName, firstName: active.firstName});
    if(activeTgId && prevActiveRef.current !== activeTgId){
      setDests([]); // clear stale groups immediately — never flash the old account's list
      refreshDests(activeTgId);
    }
    prevActiveRef.current = activeTgId;
  },[tgAccounts,activeTgId]);
  useEffect(()=>{ if(tg?.connected && !prevActiveRef.current) refreshDests(activeTgIdRef.current); },[tg?.connected]);
  const addCampaign=async(c:Campaign)=>{ setCampaigns(prev=> prev.some(x=>String(x.id)===String(c.id)) ? prev : [c,...prev]); try{ await fetch("/api/campaigns",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(c)});}catch{}};
  const updateCampaign=async(id:string,patch:Partial<Campaign>)=>{ setCampaigns(prev=>prev.map(c=>c.id===id?{...c,...patch}:c)); try{ await fetch("/api/campaigns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({patchId:id,patch})});}catch{}};
  // Server-persisted templates — every mutation below writes through to
  // /api/templates first, then syncs local state. Local-only setTemplates is
  // still exposed for the boot load; views must use these helpers for saves.
  const saveTemplate=async(t:{name:string;message:string;image?:string|null;category?:string})=>{
    const r=await fetch("/api/templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || "Failed to save template");
    setTemplates(prev=> prev.some(x=>String(x.id)===String(j.template.id)) ? prev.map(x=>String(x.id)===String(j.template.id)?j.template:x) : [j.template,...prev]);
    return j.template;
  };
  const editTemplate=async(id:string,patch:Partial<Template>&{image?:string|null})=>{
    const r=await fetch("/api/templates",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({patchId:id,patch})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || "Failed to update template");
    setTemplates(prev=>prev.map(x=>String(x.id)===String(id)?j.template:x));
    return j.template;
  };
  const deleteTemplate=async(id:string)=>{
    const r=await fetch(`/api/templates?id=${encodeURIComponent(id)}`,{method:"DELETE"});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || "Failed to delete template");
    setTemplates(prev=>prev.filter(x=>String(x.id)!==String(id)));
  };
  return <Ctx.Provider value={{lang,setLang,user,setUser,tg,setTg,tgAccounts,setTgAccounts,activeTgId,setActiveTgId,refreshTgAccounts,dests,setDests,campaigns,setCampaigns,templates,setTemplates,saveTemplate,editTemplate,deleteTemplate,addCampaign,updateCampaign: updateCampaign as any,view,setView,refreshDests,destsLoading} as any}>{children}</Ctx.Provider>
}
