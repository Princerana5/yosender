"use client";

import { useEffect, useState } from "react";
import { Field, YellowButton, groupEmoji, inputCls, toast } from "@/components/ui";
import { COUNTRIES, cx } from "@/lib/utils";

export default function AdminGroups() {
  const [groups, setGroups] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("India");

  async function load() {
    const r = await fetch("/api/admin/manage?scope=groups").then((x) => x.json());
    setGroups(r.groups || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim()) return toast("Enter a group name.", false);
    const r = await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "group-create", name, country }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast("Group created.");
      setName("");
      load();
    } else toast(j.error || "Failed.", false);
  }

  async function toggle(id: string) {
    await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "group-toggle", id }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this group? Its posts move to WORLD.")) return;
    const r = await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "group-delete", id }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast("Group deleted.");
      load();
    } else toast(j.error || "Failed.", false);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-black text-white">🌍 Groups</h1>
      <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 sm:p-5">
        <div className="text-sm font-extrabold text-white">Create group</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="FRANCE" />
          </Field>
          <Field label="Country">
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls}>
              {["Global", ...COUNTRIES].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <YellowButton onClick={create} className="w-full">+ Create</YellowButton>
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.id} className="flex items-center gap-3 rounded-2xl border border-[#134e32] bg-[#0a251b] p-3.5">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#00e676]/10 text-2xl ring-1 ring-[#00e676]/30">{groupEmoji(g.code)}</span>
            <div className="flex-1">
              <div className="text-sm font-extrabold text-white">{g.name}</div>
              <div className="text-[11px] text-[#4d7a5f]">{g.country}</div>
            </div>
            <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-bold", g.active ? "bg-emerald-100 text-emerald-700" : "bg-[#0d2f22] text-[#7fbd97]")}>
              {g.active ? "ACTIVE" : "HIDDEN"}
            </span>
            <button onClick={() => toggle(g.id)} className="rounded-lg bg-[#0d2f22] px-2.5 py-1 text-[11px] font-bold text-[#b9e6c9] hover:bg-[#134e32]">
              {g.active ? "Hide" : "Show"}
            </button>
            <button onClick={() => remove(g.id)} className="rounded-lg bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-400 hover:bg-red-500/20">
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
