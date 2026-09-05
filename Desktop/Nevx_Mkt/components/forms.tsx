"use client";

import { useEffect, useState } from "react";
import { Field, GhostButton, YellowButton, inputCls, toast } from "./ui";
import { COUNTRIES } from "@/lib/utils";

export function useMeta() {
  const [meta, setMeta] = useState<{ groups: any[]; categories: any[] } | null>(null);
  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => {});
  }, []);
  return meta;
}

export function NeedForm({
  groups,
  categories,
  defaultGroup,
  userCountry,
  onDone,
}: {
  groups: any[];
  categories: any[];
  defaultGroup: string;
  userCountry: string;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    title: "",
    description: "",
    category: categories[0]?.name || "",
    subcategory: "",
    budgetType: "range",
    budgetMin: "",
    budgetMax: "",
    country: userCountry,
    groupId: defaultGroup,
    deadline: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f.title.trim() || !f.description.trim()) {
      toast("Title and description are required.", false);
      return;
    }
    setBusy(true);
    const r = await fetch("/api/needs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      toast("Request posted successfully.");
      onDone();
    } else toast(j.error || "Could not post.", false);
  }

  return (
    <div className="space-y-3">
      <Field label="Title">
        <input value={f.title} onChange={(e) => set("title", e.target.value)} className={inputCls} placeholder="I need a website developer" maxLength={120} />
      </Field>
      <Field label="Description">
        <textarea value={f.description} onChange={(e) => set("description", e.target.value)} className={inputCls} rows={4} placeholder="Describe exactly what you need…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select value={f.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Subcategory (optional)">
          <input value={f.subcategory} onChange={(e) => set("subcategory", e.target.value)} className={inputCls} placeholder="e.g. Business site" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Budget type">
          <select value={f.budgetType} onChange={(e) => set("budgetType", e.target.value)} className={inputCls}>
            <option value="range">Range</option>
            <option value="fixed">Fixed</option>
            <option value="negotiable">Negotiable</option>
          </select>
        </Field>
        <Field label="Min ($)">
          <input type="number" min="0" value={f.budgetMin} onChange={(e) => set("budgetMin", e.target.value)} className={inputCls} placeholder="200" />
        </Field>
        <Field label="Max ($)">
          <input type="number" min="0" value={f.budgetMax} onChange={(e) => set("budgetMax", e.target.value)} className={inputCls} placeholder="400" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country">
          <select value={f.country} onChange={(e) => set("country", e.target.value)} className={inputCls}>
            {COUNTRIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Group">
          <select value={f.groupId} onChange={(e) => set("groupId", e.target.value)} className={inputCls}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Deadline (optional)">
        <input value={f.deadline} onChange={(e) => set("deadline", e.target.value)} className={inputCls} placeholder="e.g. 2 weeks" />
      </Field>
      <YellowButton onClick={submit} disabled={busy} className="w-full">
        {busy ? "Posting…" : "Post request"}
      </YellowButton>
    </div>
  );
}

export function OfferForm({
  groups,
  categories,
  defaultGroup,
  userCountry,
  onDone,
}: {
  groups: any[];
  categories: any[];
  defaultGroup: string;
  userCountry: string;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    title: "",
    description: "",
    category: categories[0]?.name || "",
    price: "",
    priceType: "fixed",
    country: userCountry,
    groupId: defaultGroup,
    deliveryTime: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f.title.trim() || !f.description.trim() || f.price === "") {
      toast("Title, description and price are required.", false);
      return;
    }
    setBusy(true);
    const r = await fetch("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      toast("Offer posted successfully.");
      onDone();
    } else toast(j.error || "Could not post.", false);
  }

  return (
    <div className="space-y-3">
      <Field label="Title">
        <input value={f.title} onChange={(e) => set("title", e.target.value)} className={inputCls} placeholder="I build professional websites" maxLength={120} />
      </Field>
      <Field label="Description">
        <textarea value={f.description} onChange={(e) => set("description", e.target.value)} className={inputCls} rows={4} placeholder="Describe your product or service…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select value={f.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Delivery time">
          <input value={f.deliveryTime} onChange={(e) => set("deliveryTime", e.target.value)} className={inputCls} placeholder="5–7 days" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price ($)">
          <input type="number" min="0" value={f.price} onChange={(e) => set("price", e.target.value)} className={inputCls} placeholder="199" />
        </Field>
        <Field label="Price type">
          <select value={f.priceType} onChange={(e) => set("priceType", e.target.value)} className={inputCls}>
            <option value="fixed">Fixed</option>
            <option value="from">Starting from</option>
            <option value="negotiable">Negotiable</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country">
          <select value={f.country} onChange={(e) => set("country", e.target.value)} className={inputCls}>
            {COUNTRIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Group">
          <select value={f.groupId} onChange={(e) => set("groupId", e.target.value)} className={inputCls}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <YellowButton onClick={submit} disabled={busy} className="w-full">
        {busy ? "Posting…" : "Post offer"}
      </YellowButton>
    </div>
  );
}

export function AuthWall({ mode }: { mode: "need" | "offer" }) {
  return (
    <div className="rounded-2xl border border-[#00e676]/25 bg-[#061b12] p-6 text-center text-white">
      <div className="text-3xl">{mode === "need" ? "🙋" : "🏷️"}</div>
      <div className="mt-2 font-extrabold">
        {mode === "need" ? "Post what you need" : "Sell / offer your service"}
      </div>
      <p className="mx-auto mt-1 max-w-xs text-sm text-white/70">
        Create a free NEVX account to post and apply. Admin mediates every deal.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <a href="/register"><YellowButton>Sign up free</YellowButton></a>
        <a href="/login"><GhostButton className="!bg-transparent !text-white !border-white/30">Log in</GhostButton></a>
      </div>
    </div>
  );
}
