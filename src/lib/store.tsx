"use client";
import React, {createContext, useContext, useState, useEffect} from "react";
export type Dest = {id:string,title:string,type:"Group"|"Channel",members:number,allowed:boolean,lastUsed:string};
export type Campaign = {id:string,name:string,destinations:string[],message:string,status:"Draft"|"Running"|"Completed"|"Paused"|"Failed"|"Repeating"|"Scheduled",successful:number,failed:number,createdAt:string,logs:{dest:string,status:string,time:string,error?:string}[]}&Record<string,any>;
export type Template = {id:string,name:string,message:string,category:string};
export type TgAccountInfo = {id:string,phone:string,username:string,displayName:string,firstName:string,status:string,createdAt:string};
type Store = {
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
  const [hydrated,setHydrated]=useState(false);
  const refreshTgAccounts = async()=>{
    try{
      const r=await fetch("/api/telegram/accounts"); const j=await r.json();
      if(r.ok && j.accounts){ setTgAccounts(j.accounts); if(j.activeId) setActiveTgId(j.activeId); }
    }catch{}
  };
  useEffect(()=>{
    const s=localStorage.getItem("tgm_store");
    if(s){try{const p=JSON.parse(s); if(p.user)setUser(p.user); if(p.tg)setTg(p.tg); if(p.view && p.view!=="connect")setView(p.view);}catch{}}
    fetch("/api/auth/me").then(r=>r.json()).then(j=>{ if(j.user) setUser(j.user); }).catch(()=>{});
    fetch("/api/telegram/me").then(r=>r.json()).then(j=>{ if(j.connected) setTg({username:j.username,phone:j.phone,connected:true, displayName: [j.firstName,j.lastName].filter(Boolean).join(" ")||j.username, firstName:j.firstName}); }).catch(()=>{});
    refreshTgAccounts();
    fetch("/api/campaigns").then(r=>r.json()).then(j=>{ if(j.campaigns) {
      // dedupe by id — keeps first occurrence, drops duplicates (can happen from Date.now() collisions)
      const seen = new Set<string>(); const unique: any[] = [];
      for (const c of j.campaigns as any[]) { if (!seen.has(String(c.id))) { seen.add(String(c.id)); unique.push(c); } }
      setCampaigns(unique.map((c:any)=>{
      let status=c.status, successful=c.successful, failed=c.failed;
      const logs=c.logs||[];
      if(logs.length){
        const ok=logs.filter((l:any)=>l.status==="Sent").length;
        if(c.status==="Running" && logs.length===c.destinations.length){
          status = ok>0 || c.destinations.length===0 ? "Completed" : "Failed";
          successful=ok; failed=logs.length-ok;
          fetch("/api/campaigns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({patchId:c.id,patch:{status,successful,failed}})}).catch(()=>{});
        } else if(logs.length) { successful=ok; failed=logs.length-ok; }
      } else if(c.status==="Running"){
        const ageMs = Date.now() - new Date(c.createdAt).getTime();
        if(ageMs > 5*60*1000){
          status="Failed"; failed=c.destinations.length; successful=0;
          fetch("/api/campaigns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({patchId:c.id,patch:{status,failed,successful,logs:[...c.destinations.map((d:string)=>({dest:d,status:"Failed",time:new Date(c.createdAt).toLocaleString(),error:"Send did not complete"}) )]}})}).catch(()=>{});
        }
      }
      return {id:c.id,name:c.name,destinations:c.destinations,message:c.message,status,successful,failed,createdAt:new Date(c.createdAt).toLocaleString(),logs,repeatIntervalId:c.repeatIntervalId,repeatEveryMins:c.repeatEveryMins,delayMins:c.delayMins,scheduledAt:c.scheduledAt,imagePreview:c.imagePreview};
    })); } }).catch(()=>{});
    setHydrated(true);
  },[]);
  useEffect(()=>{ if(!hydrated) return; localStorage.setItem("tgm_store",JSON.stringify({user,tg,view}));},[user,tg,view,hydrated]);
  const refreshDests = async()=>{
    setDestsLoading(true);
    try{ const r=await fetch("/api/telegram/dialogs"); const j=await r.json(); if(r.ok && j.dialogs) {
      const onlyGroups = (j.dialogs as any[]).filter((d:any)=> d.type==="Group");
      setDests(onlyGroups.length ? onlyGroups : j.dialogs);
      // if API returned empty array, clear stale dests
      if(!j.dialogs.length) setDests([]);
    } }catch{}
    setDestsLoading(false);
  };
  // keep tg in sync with active account — and reload dests when active changes
  const prevActiveRef = React.useRef<string|null>(null);
  useEffect(()=>{
    if(!tgAccounts.length) return;
    const active = tgAccounts.find(a=>a.id===activeTgId) || tgAccounts[0];
    if(active) setTg({username:active.username, phone:active.phone, connected:true, displayName: active.displayName, firstName: active.firstName});
    if(activeTgId && prevActiveRef.current && prevActiveRef.current !== activeTgId){
      setDests([]); // clear stale groups immediately
      refreshDests();
    }
    prevActiveRef.current = activeTgId;
  },[tgAccounts,activeTgId]);
  useEffect(()=>{ if(tg?.connected && !prevActiveRef.current) refreshDests(); },[tg?.connected]);
  const addCampaign=async(c:Campaign)=>{ setCampaigns(prev=> prev.some(x=>String(x.id)===String(c.id)) ? prev : [c,...prev]); try{ await fetch("/api/campaigns",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(c)});}catch{}};
  const updateCampaign=async(id:string,patch:Partial<Campaign>)=>{ setCampaigns(prev=>prev.map(c=>c.id===id?{...c,...patch}:c)); try{ await fetch("/api/campaigns",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({patchId:id,patch})});}catch{}};
  return <Ctx.Provider value={{user,setUser,tg,setTg,tgAccounts,setTgAccounts,activeTgId,setActiveTgId,refreshTgAccounts,dests,setDests,campaigns,setCampaigns,templates,setTemplates,addCampaign,updateCampaign: updateCampaign as any,view,setView,refreshDests,destsLoading} as any}>{children}</Ctx.Provider>
}
