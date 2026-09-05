"use client";

import { useEffect, useState } from "react";
import { Field, YellowButton, inputCls, toast } from "@/components/ui";

const ICONS = ["💻", "🎨", "📣", "✍️", "🎬", "🔌", "📱", "🏠", "💼", "🎓", "🧠", "💿", "👕", "📦", "🛒", "🏥"];

export default function AdminCategories() {
  const [cats, setCats] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📦");

  async function load() {
    const r = await fetch("/api/admin/manage?scope=categories").then((x) => x.json());
    setCats(r.categories || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim()) return toast("Enter a name.", false);
    const r = await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "category-create", name, icon }),
    });
    if (r.ok) {
      toast("Category created.");
      setName("");
      load();
    } else toast("Failed.", false);
  }

  async function remove(id: string) {
    await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "category-delete", id }),
    });
    toast("Category deleted.");
    load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-black text-white">🗂️ Categories</h1>
      <div className="rounded-2xl border border-[#134e32] bg-[#0a251b] p-4 sm:p-5">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Plumbing" />
          </Field>
          <Field label="Icon">
            <select value={icon} onChange={(e) => setIcon(e.target.value)} className={inputCls}>
              {ICONS.map((i) => <option key={i}>{i}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <YellowButton onClick={create} className="w-full">+ Create</YellowButton>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-full border border-[#134e32] bg-[#0a251b] py-2 pl-4 pr-2">
            <span>{c.icon}</span>
            <b className="text-sm text-white">{c.name}</b>
            <button onClick={() => remove(c.id)} className="grid h-6 w-6 place-items-center rounded-full bg-red-500/10 text-xs text-red-400 hover:bg-red-500/20" title="Delete">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
