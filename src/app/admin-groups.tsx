"use client";
import { useState, useEffect, useCallback } from "react";
import { Search, Copy, Plus, Trash2, Download, Upload, X, Check, AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Pencil, Tag, FolderPlus, Users, RefreshCw } from "lucide-react";
import { detectGroupType } from "@/lib/group-links";

type Group = {
  id: string;
  group_link: string;
  normalized_link: string;
  group_type: string;
  group_name: string | null;
  group_username: string | null;
  category_id: string | null;
  category_name: string;
  status: string;
  source: string;
  submitted_by_email: string;
  submitted_by_name: string;
  first_added_at: string;
  last_seen_at: string;
  notes: string | null;
  admin_notes: string | null;
  member_count: number | null;
  members_updated_at: string | null;
};

type Category = { id: string; name: string; slug: string; color: string; groupCount?: number };

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive: "bg-slate-100 text-slate-600 border-slate-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
};
const TYPE_COLORS: Record<string, string> = {
  public: "bg-[#EFF6FF] text-blue-700 border-[#BFDBFE]",
  private: "bg-violet-50 text-violet-700 border-violet-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};
const SOURCE_COLORS: Record<string, string> = {
  user: "bg-slate-100 text-slate-600 border-slate-200",
  admin: "bg-[#229ED9] text-white border-[#229ED9]",
  import: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export function GroupsTab({ notify }: { notify: (msg: string, isErr?: boolean) => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // filters
  const [search, setSearch] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSource, setFSource] = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");
  const [sortBy, setSortBy] = useState("first_added_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // modals
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ link: "", name: "", type: "" as string, category_id: "", status: "active", notes: "", show_in_browse: true });
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<Group | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [showBulkCat, setShowBulkCat] = useState(false);
  const [bulkCat, setBulkCat] = useState("");
  const [showCats, setShowCats] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCat, setImportCat] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadCats = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/categories");
      const j = await r.json();
      if (r.ok) setCategories(j.categories || []);
    } catch {}
  }, []);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: String(limit),
        sortBy,
        sortDir,
      });
      if (search.trim()) params.set("search", search.trim());
      if (fCategory) params.set("categoryId", fCategory);
      if (fType) params.set("groupType", fType);
      if (fStatus) params.set("status", fStatus);
      if (fSource) params.set("source", fSource);
      if (fDateFrom) params.set("dateFrom", fDateFrom);
      if (fDateTo) params.set("dateTo", fDateTo);
      const r = await fetch(`/api/admin/groups?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setGroups(j.groups);
      setTotal(j.total);
      setPage(j.page);
      setTotalPages(j.totalPages);
      setStats(j.stats);
      setSelected(new Set());
    } catch (e: any) {
      notify(e.message, true);
    }
    setLoading(false);
  }, [search, fCategory, fType, fStatus, fSource, fDateFrom, fDateTo, sortBy, sortDir, limit]);

  useEffect(() => { load(1); loadCats(); }, []);

  const clearFilters = () => {
    setSearch(""); setFCategory(""); setFType(""); setFStatus(""); setFSource(""); setFDateFrom(""); setFDateTo("");
    setSortBy("first_added_at"); setSortDir("desc");
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (selected.size === groups.length && groups.length) setSelected(new Set());
    else setSelected(new Set(groups.map((g) => g.id)));
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    notify("Link copied");
  };

  const doAdd = async () => {
    if (!addForm.link.trim()) return notify("Group link required", true);
    setAdding(true);
    try {
      const r = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_link: addForm.link.trim(),
          group_name: addForm.name.trim() || null,
          category_id: addForm.category_id || null,
          status: addForm.status,
          notes: addForm.notes.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify(j.isNew ? `Group added${addForm.show_in_browse && addForm.status === "active" ? " — visible in Browse Groups" : ""}` : "Group already exists — last seen updated");
      setShowAdd(false);
      setAddForm({ link: "", name: "", type: "", category_id: "", status: "active", notes: "", show_in_browse: true });
      load(page); loadCats();
    } catch (e: any) { notify(e.message, true); }
    setAdding(false);
  };

  const doDelete = async (id: string) => {
    if (!confirm("Delete this group permanently?")) return;
    try {
      const r = await fetch(`/api/admin/groups?id=${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify("Group deleted");
      load(page); loadCats();
    } catch (e: any) { notify(e.message, true); }
  };

  const doBulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} groups permanently?`)) return;
    try {
      const r = await fetch("/api/admin/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify(`Deleted ${j.deleted} groups`);
      load(page); loadCats();
    } catch (e: any) { notify(e.message, true); }
  };

  const doBulkCategory = async () => {
    if (!selected.size || !bulkCat) return;
    try {
      const r = await fetch("/api/admin/groups/bulk-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], category_id: bulkCat }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify(`${j.updated} groups → ${j.category}`);
      setShowBulkCat(false); setBulkCat("");
      load(page); loadCats();
    } catch (e: any) { notify(e.message, true); }
  };

  const quickStatus = async (id: string, status: string) => {
    try {
      const r = await fetch("/api/admin/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, patch: { status } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify(`Status → ${status}`);
      load(page);
    } catch (e: any) { notify(e.message, true); }
  };

  const openDetail = (g: Group) => {
    setDetail(g);
    setEditing(false);
    setEditForm({
      group_name: g.group_name || "",
      group_link: g.group_link,
      category_id: g.category_id || "cat_uncategorized",
      status: g.status,
      notes: g.notes || "",
      admin_notes: g.admin_notes || "",
    });
  };

  const saveDetail = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: detail.id,
          patch: {
            group_name: editForm.group_name,
            group_link: editForm.group_link,
            category_id: editForm.category_id,
            status: editForm.status,
            notes: editForm.notes,
            admin_notes: editForm.admin_notes,
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify("Group updated");
      setDetail(j.group);
      setEditing(false);
      load(page); loadCats();
    } catch (e: any) { notify(e.message, true); }
    setSaving(false);
  };

  const doExport = (scope: string, extra?: string) => {
    let url = `/api/admin/groups/export?scope=${scope}`;
    if (scope === "category" && (extra || fCategory)) url += `&categoryId=${extra || fCategory}`;
    if (scope === "selected" && selected.size) url += `&ids=${[...selected].join(",")}`;
    window.open(url, "_blank");
  };

  // Import accepts EITHER a pasted list (1 link per line) OR a .txt/.csv/
  // .xlsx file — whichever is provided. Pasted text wins when both are set.
  const importLinks = [...new Set(importText.split("\n").map(s => s.trim()).filter(Boolean))];
  const doImport = async () => {
    const pasted = importText.split("\n").map(s => s.trim()).filter(Boolean);
    if (!pasted.length && !importFile) return notify("Paste links or choose a file first", true);
    setImporting(true); setImportResult(null);
    try {
      const fd = new FormData();
      if (pasted.length) fd.append("links", pasted.join("\n"));
      else if (importFile) fd.append("file", importFile);
      if (importCat) fd.append("category_id", importCat);
      const r = await fetch("/api/admin/groups/import", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setImportResult(j);
      notify(j.message || "Import done");
      load(1); loadCats();
    } catch (e: any) { notify(e.message, true); }
    setImporting(false);
  };

  const createCat = async () => {
    if (!newCat.trim()) return;
    try {
      const r = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCat.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setNewCat("");
      loadCats(); load(page);
      notify(`Category "${j.category.name}" created`);
    } catch (e: any) { notify(e.message, true); }
  };

  const fmtMembers = (n: number | null | undefined) => {
    if (typeof n !== "number") return "—";
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
    return n.toLocaleString();
  };

  const refreshMembers = async (ids?: string[]) => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/admin/groups/refresh-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids?.length ? { ids } : {}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify(`Member counts updated for ${j.updated} groups${j.failed ? ` (${j.failed} unavailable)` : ""}`);
      load(page); loadCats();
    } catch (e: any) { notify(e.message, true); }
    setRefreshing(false);
  };

  const renameCat = async (id: string) => {
    if (!editCatName.trim()) return;
    try {
      const r = await fetch("/api/admin/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: editCatName.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setEditCatId(null);
      loadCats(); load(page);
      notify("Category renamed");
    } catch (e: any) { notify(e.message, true); }
  };

  const deleteCat = async (id: string, name: string) => {
    if (!confirm(`Delete category "${name}"? Groups move to Uncategorized.`)) return;
    try {
      const r = await fetch(`/api/admin/categories?id=${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      notify(`Deleted — ${j.movedToUncategorized} groups → Uncategorized`);
      if (fCategory === id) setFCategory("");
      loadCats(); load(page);
    } catch (e: any) { notify(e.message, true); }
  };

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <div className="mt-4 space-y-4">
      {/* ── Category stats dashboard ── */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] font-bold tracking-widest text-white/60">TOTAL GROUPS</div>
            <div className="text-3xl font-extrabold">{(stats?.total ?? total).toLocaleString()}</div>
          </div>
          {(stats as any)?.totalMembers > 0 && (
            <div className="pl-4 border-l border-white/15">
              <div className="text-[11px] font-bold tracking-widest text-white/60">TOTAL MEMBERS</div>
              <div className="text-3xl font-extrabold">{Number((stats as any).totalMembers).toLocaleString()}</div>
              <div className="text-[11px] text-white/50">across {(stats as any).withMembers ?? 0} groups</div>
            </div>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => refreshMembers()} disabled={refreshing} className="bg-emerald-500 text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 hover:bg-emerald-400"><Users size={14} /> {refreshing ? "Refreshing…" : "Refresh Members"}</button>
            <button onClick={() => setShowAdd(true)} className="bg-white text-slate-900 px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"><Plus size={14} /> Add Group</button>
            <button onClick={() => setShowCats(!showCats)} className="bg-white/10 border border-white/20 px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"><Tag size={13} /> Categories</button>
          </div>
        </div>
        {stats?.byCategory?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {stats.byCategory.map((c: any) => (
              <button
                key={c.id}
                onClick={() => { setFCategory(fCategory === c.id ? "" : c.id); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition ${fCategory === c.id ? "bg-white text-slate-900 border-white" : "bg-white/10 text-white border-white/20 hover:bg-white/15"}`}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                {c.name}
                <span className="opacity-70">{Number(c.count).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Category manager ── */}
      {showCats && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-bold flex items-center gap-2"><FolderPlus size={16} /> Category Management</h3>
          <div className="mt-3 flex gap-2">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createCat()} placeholder="New category name — e.g. Crypto" className="flex-1 border border-slate-200 rounded-full px-4 py-2.5 text-sm outline-none focus:border-[#229ED9]" />
            <button onClick={createCat} className="bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-xs font-bold">Create</button>
          </div>
          <div className="mt-3 space-y-1.5 max-h-64 overflow-auto">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                {editCatId === c.id ? (
                  <>
                    <input value={editCatName} onChange={(e) => setEditCatName(e.target.value)} className="flex-1 border border-slate-200 rounded-full px-3 py-1.5 text-sm" />
                    <button onClick={() => renameCat(c.id)} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1"><Check size={12} /> Save</button>
                    <button onClick={() => setEditCatId(null)} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setFCategory(c.id); setShowCats(false); load(1); }} className="font-semibold text-sm text-left flex-1 hover:text-[#229ED9]" title="View groups in this category">
                      {c.name} <span className="text-xs text-slate-400 font-medium">· {c.groupCount ?? 0} groups</span>
                    </button>
                    {c.id !== "cat_uncategorized" && (
                      <>
                        <button onClick={() => { setEditCatId(c.id); setEditCatName(c.name); }} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1"><Pencil size={11} /> Rename</button>
                        <button onClick={() => deleteCat(c.id, c.name)} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-full flex items-center gap-1"><Trash2 size={11} /> Delete</button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Search & filters ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-3 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(1)} placeholder="Search name, username, link, user, notes…" className="w-full border border-slate-200 rounded-full pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[#229ED9]" />
          </div>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="border border-slate-200 rounded-full px-3 py-2.5 text-sm bg-white max-w-[160px]">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} className="border border-slate-200 rounded-full px-3 py-2.5 text-sm bg-white">
            <option value="">All types</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="unknown">Unknown</option>
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="border border-slate-200 rounded-full px-3 py-2.5 text-sm bg-white">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="pending">Pending</option>
            <option value="blocked">Blocked</option>
          </select>
          <select value={fSource} onChange={(e) => setFSource(e.target.value)} className="border border-slate-200 rounded-full px-3 py-2.5 text-sm bg-white">
            <option value="">All sources</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="import">Import</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <label className="flex items-center gap-1.5 font-medium text-slate-500">Added from <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} className="border border-slate-200 rounded-full px-2 py-1.5 text-xs bg-white" /></label>
          <label className="flex items-center gap-1.5 font-medium text-slate-500">to <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} className="border border-slate-200 rounded-full px-2 py-1.5 text-xs bg-white" /></label>
          <select value={`${sortBy}:${sortDir}`} onChange={(e) => { const [b, d] = e.target.value.split(":"); setSortBy(b); setSortDir(d as any); }} className="border border-slate-200 rounded-full px-3 py-1.5 text-xs bg-white">
            <option value="first_added_at:desc">Newest first</option>
            <option value="first_added_at:asc">Oldest first</option>
            <option value="last_seen_at:desc">Recently seen</option>
            <option value="group_name:asc">Name A–Z</option>
            <option value="group_name:desc">Name Z–A</option>
          </select>
          <button onClick={() => load(1)} className="bg-[#229ED9] text-white px-5 py-2 rounded-full font-bold">Search</button>
          <button onClick={() => { clearFilters(); setTimeout(() => load(1), 0); }} className="border border-slate-200 bg-white px-4 py-2 rounded-full font-bold">Clear</button>
          <span className="text-slate-500 ml-auto">{total.toLocaleString()} groups</span>
        </div>
      </div>

      {/* ── Bulk bar + export/import ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap gap-2 items-center">
        {selected.size > 0 ? (
          <>
            <span className="text-xs font-bold bg-[#229ED9] text-white px-3 py-1.5 rounded-full">{selected.size} selected</span>
            <button onClick={() => setShowBulkCat(true)} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full">Assign Category</button>
            <button onClick={() => refreshMembers([...selected])} disabled={refreshing} className="text-xs font-bold bg-white border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full flex items-center gap-1 disabled:opacity-50"><RefreshCw size={12} /> Refresh Members</button>
            <button onClick={() => doExport("selected")} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1"><Download size={12} /> Export Selected</button>
            <button onClick={doBulkDelete} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-full">Delete Selected</button>
            <button onClick={() => setSelected(new Set())} className="text-xs font-bold text-slate-400">Clear</button>
          </>
        ) : (
          <span className="text-xs text-slate-400 px-1">Tick checkboxes to bulk-assign, export or delete</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => doExport("all")} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-slate-50"><Download size={12} /> Export All</button>
          <button onClick={() => doExport("category")} disabled={!fCategory} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-slate-50 disabled:opacity-40" title={fCategory ? "Export current category filter" : "Select a category filter first"}><Download size={12} /> Export Category</button>
          <button onClick={() => doExport("by-category")} className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full flex items-center gap-1"><Download size={12} /> Export All Categories</button>
          <button onClick={() => setShowImport(true)} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1 hover:bg-slate-50">
            <Upload size={12} /> Import
          </button>
        </div>
      </div>

      {/* ── Import modal: paste 1-link-per-line OR upload .txt/.csv/.xlsx ── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowImport(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2"><Upload size={15} /> Import Groups</h3>
              <button onClick={() => setShowImport(false)} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center"><X size={14} /></button>
            </div>
            <label className="block text-xs font-bold text-slate-700">PASTE LINKS — 1 PER LINE
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8} placeholder={"https://t.me/mygroup\nhttps://t.me/+AbCdEfGhIjKlMnOp\n@anothergroup"} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono font-normal outline-none focus:border-indigo-500" />
            </label>
            <div className="flex items-center gap-2 text-xs">
              <span className={`font-bold px-2.5 py-1 rounded-full border ${importLinks.length ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>{importLinks.length.toLocaleString()} links</span>
              {importText.trim() && <button onClick={() => setImportText("")} className="font-bold text-slate-400 hover:text-slate-600 ml-auto">Clear</button>}
            </div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400"><span className="flex-1 h-px bg-slate-200" /> OR UPLOAD FILE <span className="flex-1 h-px bg-slate-200" /></div>
            <label className="flex items-center gap-2 border border-dashed border-slate-300 rounded-xl px-3 py-2.5 text-sm cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition">
              <Upload size={14} className="text-indigo-600 shrink-0" />
              <span className="font-semibold text-slate-700 truncate">{importFile ? importFile.name : "Choose .txt, .csv or .xlsx file…"}</span>
              {importFile && <span className="text-xs text-slate-400 shrink-0">({(importFile.size / 1024).toFixed(1)} KB)</span>}
              {importFile && <button onClick={(e) => { e.preventDefault(); setImportFile(null); }} className="ml-auto text-slate-400 hover:text-red-600 shrink-0"><X size={14} /></button>}
              <input type="file" accept=".txt,.csv,.xlsx,.xls" className="hidden" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
            </label>
            <label className="block text-xs font-bold text-slate-700">CATEGORY
              <select value={importCat} onChange={(e) => setImportCat(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal bg-white">
                <option value="">No category (→ Uncategorized)</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button onClick={doImport} disabled={importing || (!importLinks.length && !importFile)} className="w-full bg-indigo-600 text-white py-3 rounded-full text-sm font-bold disabled:opacity-50">{importing ? "Importing…" : `Import ${((importLinks.length || (importFile ? 1 : 0)) ? (importLinks.length || "file") : "")} ${importLinks.length === 1 ? "group" : "groups"}`.trim() || "Import"}</button>
            {importResult && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-sm font-bold text-slate-900">Import Completed</div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  {[["Total Rows", importResult.summary.totalRows], ["Valid", importResult.summary.validGroups], ["New", importResult.summary.newGroups], ["Duplicates", importResult.summary.duplicates], ["Invalid", importResult.summary.invalidLinks]].map(([k, v]: any) => (
                    <div key={k} className="bg-white border border-slate-200 rounded-xl px-2 py-2"><div className="text-[10px] font-bold tracking-widest text-slate-400">{String(k).toUpperCase()}</div><div className="font-extrabold">{v}</div></div>
                  ))}
                </div>
                {importResult.errors?.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-bold text-red-600">Invalid rows ({importResult.errors.length}) — click to view</summary>
                    <div className="mt-1 max-h-40 overflow-auto space-y-1">
                      {importResult.errors.slice(0, 50).map((e: any, i: number) => <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-2 py-1 font-mono truncate">{e.link} — {e.error}</div>)}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[1200px]">
          <thead className="bg-slate-50 text-xs font-bold tracking-widest text-slate-500">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={groups.length > 0 && selected.size === groups.length} onChange={toggleAll} className="accent-[#229ED9] w-4 h-4" /></th>
              <th className="text-left px-3 py-3">GROUP NAME</th>
              <th className="text-left px-3 py-3">GROUP LINK</th>
              <th className="px-3 py-3">TYPE</th>
              <th className="px-3 py-3">CATEGORY</th>
              <th className="px-3 py-3">MEMBERS</th>
              <th className="px-3 py-3">STATUS</th>
              <th className="px-3 py-3">SOURCE</th>
              <th className="text-left px-3 py-3">SUBMITTED BY</th>
              <th className="px-3 py-3">ADDED</th>
              <th className="px-3 py-3">LAST SEEN</th>
              <th className="px-3 py-3 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-3 py-3 text-center"><input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleSelect(g.id)} className="accent-[#229ED9] w-4 h-4" /></td>
                <td className="px-3 py-3 max-w-[180px]">
                  <button onClick={() => openDetail(g)} className="font-semibold text-slate-900 hover:text-[#229ED9] text-left truncate block max-w-full">{g.group_name || <span className="text-slate-400 italic">Unnamed</span>}</button>
                  {g.group_username && <div className="text-xs text-slate-400">@{g.group_username}</div>}
                </td>
                <td className="px-3 py-3 max-w-[200px]">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-slate-600 truncate">{g.group_link}</span>
                    <button onClick={() => copy(g.group_link)} className="text-slate-400 hover:text-slate-900 shrink-0" title="Copy link"><Copy size={12} /></button>
                    <a href={g.normalized_link} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-[#229ED9] shrink-0" title="Open"><ExternalLink size={12} /></a>
                  </div>
                </td>
                <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${TYPE_COLORS[g.group_type] || TYPE_COLORS.unknown}`}>{g.group_type.toUpperCase()}</span></td>
                <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full whitespace-nowrap"><span className="w-2 h-2 rounded-full" style={{ background: categories.find((c) => c.id === g.category_id)?.color || "#64748B" }} />{g.category_name}</span></td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full whitespace-nowrap" title={g.members_updated_at ? `Updated ${fmtDate(g.members_updated_at)}` : "Not resolved yet — use Refresh Members"}>
                    <Users size={11} className="text-slate-400" />{fmtMembers(g.member_count)}
                  </span>
                  {g.members_updated_at && <div className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">{new Date(g.members_updated_at).toLocaleDateString()}</div>}
                </td>
                <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${STATUS_COLORS[g.status] || STATUS_COLORS.active}`}>{g.status.toUpperCase()}</span></td>
                <td className="px-3 py-3"><span className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${SOURCE_COLORS[g.source] || SOURCE_COLORS.user}`}>{g.source.toUpperCase()}</span></td>
                <td className="px-3 py-3 max-w-[160px]"><div className="text-xs font-semibold truncate">{g.submitted_by_name}</div><div className="text-[11px] text-slate-400 truncate">{g.submitted_by_email}</div></td>
                <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{fmtDate(g.first_added_at)}</td>
                <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{fmtDate(g.last_seen_at)}</td>
                <td className="px-3 py-3">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => openDetail(g)} className="text-xs font-bold bg-white border border-slate-200 px-2.5 py-1.5 rounded-full hover:bg-slate-50">View</button>
                    <select value={g.status} onChange={(e) => quickStatus(g.id, e.target.value)} className="text-xs font-bold bg-white border border-slate-200 px-1.5 py-1.5 rounded-full" title="Change status">
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="pending">Pending</option>
                      <option value="blocked">Blocked</option>
                    </select>
                    <button onClick={() => doDelete(g.id)} className="text-xs font-bold bg-white border border-red-200 text-red-600 px-2.5 py-1.5 rounded-full hover:bg-red-50"><Trash2 size={12} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!groups.length && !loading && (
          <div className="p-10 text-center">
            <div className="text-sm font-semibold text-slate-700">No groups found</div>
            <div className="text-xs text-slate-400 mt-1">Groups appear here automatically when users submit links in Join Groups — or add one manually.</div>
            <button onClick={() => setShowAdd(true)} className="mt-4 bg-[#229ED9] text-white px-5 py-2.5 rounded-full text-xs font-bold">+ Add Group</button>
          </div>
        )}
        {loading && <div className="p-8 text-center text-sm text-slate-400">Loading…</div>}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center items-center">
          <button disabled={page <= 1} onClick={() => load(page - 1)} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40 flex items-center gap-1"><ChevronLeft size={13} /> Prev</button>
          <span className="text-xs text-slate-500">Page {page} of {totalPages} · {total.toLocaleString()} total</span>
          <button disabled={page >= totalPages} onClick={() => load(page + 1)} className="border border-slate-200 bg-white px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40 flex items-center gap-1">Next <ChevronRight size={13} /></button>
        </div>
      )}

      {/* ── Add Group modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Add Group</h3>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center"><X size={14} /></button>
            </div>
            <label className="block text-xs font-bold">GROUP LINK *<input value={addForm.link} onChange={(e) => setAddForm({ ...addForm, link: e.target.value })} placeholder="https://t.me/username or https://t.me/+hash" className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal outline-none focus:border-[#229ED9]" />
              {addForm.link.trim() && (() => { const t = detectGroupType(addForm.link.trim()); return (
                <span className={`mt-1.5 inline-flex text-[10px] font-bold tracking-widest px-2 py-1 rounded-full border ${t === "public" ? "bg-[#EFF6FF] text-blue-700 border-[#BFDBFE]" : t === "private" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                  {t === "public" ? "PUBLIC GROUP" : t === "private" ? "PRIVATE GROUP" : "UNKNOWN TYPE"}
                </span>
              ); })()}
            </label>
            <label className="block text-xs font-bold">GROUP NAME<input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Optional" className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal outline-none focus:border-[#229ED9]" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-bold">CATEGORY<select value={addForm.category_id} onChange={(e) => setAddForm({ ...addForm, category_id: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal bg-white"><option value="">Uncategorized</option>{categories.filter((c) => c.id !== "cat_uncategorized").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="block text-xs font-bold">STATUS<select value={addForm.status} onChange={(e) => setAddForm({ ...addForm, status: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal bg-white"><option value="active">Active</option><option value="pending">Pending</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option></select></label>
            </div>
            <label className="block text-xs font-bold">NOTES<textarea value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} rows={2} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal outline-none focus:border-[#229ED9]" /></label>
            <label className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={addForm.show_in_browse} onChange={(e) => setAddForm({ ...addForm, show_in_browse: e.target.checked })} className="accent-emerald-600 w-4 h-4" />
              <span className="text-xs font-bold text-emerald-800">SHOW IN BROWSE GROUPS <span className="font-medium text-emerald-600">— premium users can join it</span></span>
            </label>
            <button onClick={doAdd} disabled={adding} className="w-full bg-[#229ED9] text-white py-3 rounded-full text-sm font-bold disabled:opacity-50">{adding ? "Adding…" : "Add Group"}</button>
          </div>
        </div>
      )}

      {/* ── Bulk category modal ── */}
      {showBulkCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowBulkCat(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-3">
            <h3 className="font-bold">Assign {selected.size} groups to…</h3>
            <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={doBulkCategory} disabled={!bulkCat} className="flex-1 bg-[#229ED9] text-white py-2.5 rounded-full text-sm font-bold disabled:opacity-50">Confirm</button>
              <button onClick={() => setShowBulkCat(false)} className="flex-1 border border-slate-200 py-2.5 rounded-full text-sm font-bold">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail modal ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Group Details</h3>
              <div className="flex gap-2">
                {!editing && <button onClick={() => setEditing(true)} className="text-xs font-bold bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1"><Pencil size={12} /> Edit</button>}
                <button onClick={() => setDetail(null)} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center"><X size={14} /></button>
              </div>
            </div>
            {!editing ? (
              <div className="space-y-2 text-sm">
                {[
                  ["Group Name", detail.group_name || "—"],
                  ["Group Link", detail.group_link],
                  ["Normalized", detail.normalized_link],
                  ["Type", detail.group_type],
                  ["Username", detail.group_username ? "@" + detail.group_username : "—"],
                  ["Category", detail.category_name],
                  ["Members", typeof detail.member_count === "number" ? `${detail.member_count.toLocaleString()}${detail.members_updated_at ? ` (updated ${fmtDate(detail.members_updated_at)})` : ""}` : "Not resolved yet"],
                  ["Status", detail.status],
                  ["Source", detail.source],
                  ["Submitted By", `${detail.submitted_by_name} (${detail.submitted_by_email})`],
                  ["First Added", fmtDate(detail.first_added_at)],
                  ["Last Seen", fmtDate(detail.last_seen_at)],
                  ["Notes", detail.notes || "—"],
                  ["Admin Notes", detail.admin_notes || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3 border-b border-slate-50 pb-2">
                    <span className="w-32 shrink-0 text-xs font-bold tracking-wide text-slate-400">{String(k).toUpperCase()}</span>
                    <span className="font-medium break-all">{v}</span>
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button onClick={() => copy(detail.group_link)} className="flex-1 border border-slate-200 py-2.5 rounded-full text-xs font-bold flex items-center justify-center gap-1"><Copy size={12} /> Copy Link</button>
                  <button onClick={() => { refreshMembers([detail.id]); }} disabled={refreshing} className="flex-1 border border-emerald-200 text-emerald-700 py-2.5 rounded-full text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-50"><RefreshCw size={12} /> {refreshing ? "Refreshing…" : "Refresh Members"}</button>
                  <a href={detail.normalized_link} target="_blank" rel="noopener noreferrer" className="flex-1 bg-[#229ED9] text-white py-2.5 rounded-full text-xs font-bold flex items-center justify-center gap-1">Open <ExternalLink size={12} /></a>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-xs font-bold">GROUP NAME<input value={editForm.group_name} onChange={(e) => setEditForm({ ...editForm, group_name: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal outline-none focus:border-[#229ED9]" /></label>
                <label className="block text-xs font-bold">GROUP LINK<input value={editForm.group_link} onChange={(e) => setEditForm({ ...editForm, group_link: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal font-mono outline-none focus:border-[#229ED9]" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs font-bold">CATEGORY<select value={editForm.category_id} onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal bg-white">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label className="block text-xs font-bold">STATUS<select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal bg-white"><option value="active">Active</option><option value="pending">Pending</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option></select></label>
                </div>
                <label className="block text-xs font-bold">NOTES<textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal outline-none focus:border-[#229ED9]" /></label>
                <label className="block text-xs font-bold">ADMIN NOTES<textarea value={editForm.admin_notes} onChange={(e) => setEditForm({ ...editForm, admin_notes: e.target.value })} rows={2} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal outline-none focus:border-[#229ED9]" /></label>
                <div className="flex gap-2">
                  <button onClick={saveDetail} disabled={saving} className="flex-1 bg-[#229ED9] text-white py-2.5 rounded-full text-sm font-bold disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
                  <button onClick={() => setEditing(false)} className="flex-1 border border-slate-200 py-2.5 rounded-full text-sm font-bold">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
