import fs from "fs";
import path from "path";
import { normalizeGroupLink, detectGroupType, extractUsername } from "./group-links";

const DB_DIR = process.env.VERCEL ? path.join("/tmp", ".data") : path.join(process.cwd(), ".data");
const GROUPS_FILE = path.join(DB_DIR, "groups.json");
const CATEGORIES_FILE = path.join(DB_DIR, "categories.json");

// ── Types ──
export type GroupStatus = "active" | "inactive" | "pending" | "blocked";
export type GroupSource = "user" | "admin" | "import";
export type GroupType = "public" | "private" | "unknown";

export type GroupRecord = {
  id: string;
  group_link: string;
  normalized_link: string;
  group_type: GroupType;
  group_name: string | null;
  group_username: string | null;
  category_id: string | null;
  category_name: string;
  status: GroupStatus;
  source: GroupSource;
  submitted_by: string; // userId
  submitted_by_email: string;
  submitted_by_name: string;
  first_added_at: string;
  last_seen_at: string;
  updated_at: string;
  notes: string | null;
  admin_notes: string | null;
  // Live member count, resolved via Telegram (participantsCount). Null = unknown yet.
  member_count: number | null;
  members_updated_at: string | null;
};

export type CategoryRecord = {
  id: string;
  name: string;
  slug: string;
  color: string;
  created_at: string;
  updated_at: string;
};

const UNCATEGORIZED_ID = "cat_uncategorized";
const UNCATEGORIZED_NAME = "Uncategorized";

function ensureFiles() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  for (const f of [GROUPS_FILE, CATEGORIES_FILE]) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");
}

function readJson<T>(file: string): T[] {
  ensureFiles();
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}
function writeJson(file: string, data: any) {
  ensureFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Categories ──
export function getCategories(): CategoryRecord[] {
  const cats = readJson<CategoryRecord>(CATEGORIES_FILE);
  // ensure Uncategorized exists
  if (!cats.find((c) => c.id === UNCATEGORIZED_ID)) {
    const unc: CategoryRecord = {
      id: UNCATEGORIZED_ID,
      name: UNCATEGORIZED_NAME,
      slug: "uncategorized",
      color: "#64748B",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    cats.unshift(unc);
    writeJson(CATEGORIES_FILE, cats);
    return cats;
  }
  return cats;
}

export function saveCategories(cats: CategoryRecord[]) {
  writeJson(CATEGORIES_FILE, cats);
}

export function getCategoryById(id: string): CategoryRecord | null {
  return getCategories().find((c) => c.id === id) || null;
}

export function getCategoryByName(name: string): CategoryRecord | null {
  return getCategories().find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
}

export function createCategory(name: string, color?: string): CategoryRecord {
  const cats = getCategories();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Category name required");
  if (cats.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())) throw new Error("Category already exists");
  const cat: CategoryRecord = {
    id: `cat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    slug: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    color: color || randomColor(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  cats.push(cat);
  saveCategories(cats);
  return cat;
}

function randomColor() {
  const colors = ["#229ED9", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#06B6D4", "#F97316", "#84CC16", "#EC4899", "#6366F1"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Groups ──
export function getGroups(): GroupRecord[] {
  return readJson<GroupRecord>(GROUPS_FILE);
}

export function saveGroups(groups: GroupRecord[]) {
  writeJson(GROUPS_FILE, groups);
}

export function getGroupById(id: string): GroupRecord | null {
  return getGroups().find((g) => g.id === id) || null;
}

export function getGroupByNormalized(normalized: string): GroupRecord | null {
  return getGroups().find((g) => g.normalized_link === normalized) || null;
}

/**
 * Upsert a group link — dedup by normalized_link.
 * Returns { group, isNew }
 */
export function upsertGroupLink(opts: {
  rawLink: string;
  submittedBy: string;
  submittedByEmail: string;
  submittedByName: string;
  source?: GroupSource;
  groupName?: string | null;
  categoryId?: string | null;
  status?: GroupStatus;
  notes?: string | null;
  adminNotes?: string | null;
  memberCount?: number | null;
}): { group: GroupRecord; isNew: boolean } {
  const raw = String(opts.rawLink || "").trim();
  if (!raw) throw new Error("Group link required");
  const normalized = normalizeGroupLink(raw);
  if (!normalized) throw new Error(`Invalid group link: ${raw}`);
  const type = detectGroupType(raw) as GroupType;
  const username = extractUsername(normalized);

  const now = new Date().toISOString();
  const groups = getGroups();

  const existing = groups.find((g) => g.normalized_link === normalized);
  if (existing) {
    // update last_seen_at, keep original
    existing.last_seen_at = now;
    existing.updated_at = now;
    // optionally update name if provided and existing has none
    if (opts.groupName && !existing.group_name) existing.group_name = opts.groupName;
    // refresh cached member count when a fresh one is supplied
    if (typeof opts.memberCount === "number" && opts.memberCount >= 0) {
      existing.member_count = opts.memberCount;
      existing.members_updated_at = now;
    }
    saveGroups(groups);
    return { group: existing, isNew: false };
  }

  // resolve category
  let categoryId: string | null = opts.categoryId || null;
  let categoryName = UNCATEGORIZED_NAME;
  if (categoryId) {
    const cat = getCategoryById(categoryId);
    if (cat) categoryName = cat.name;
    else categoryId = UNCATEGORIZED_ID;
  } else {
    categoryId = UNCATEGORIZED_ID;
  }

  const freshCount = typeof opts.memberCount === "number" && opts.memberCount >= 0 ? opts.memberCount : null;
  const group: GroupRecord = {
    id: `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    group_link: raw,
    normalized_link: normalized,
    group_type: type,
    group_name: opts.groupName || username || null,
    group_username: username,
    category_id: categoryId,
    category_name: categoryName,
    status: opts.status || "active",
    source: opts.source || "user",
    submitted_by: opts.submittedBy,
    submitted_by_email: opts.submittedByEmail,
    submitted_by_name: opts.submittedByName,
    first_added_at: now,
    last_seen_at: now,
    updated_at: now,
    notes: opts.notes || null,
    admin_notes: opts.adminNotes || null,
    member_count: freshCount,
    members_updated_at: freshCount !== null ? now : null,
  };
  groups.push(group);
  saveGroups(groups);
  return { group, isNew: true };
}

/**
 * Bulk upsert — for import or auto-collection of many links
 */
export type GroupSeed = {
  link: string;
  name?: string | null;
  username?: string | null;
  memberCount?: number | null;
};

export function bulkUpsertGroupLinks(
  links: Array<string | GroupSeed>,
  meta: { submittedBy: string; submittedByEmail: string; submittedByName: string; source: GroupSource; categoryId?: string | null }
): { total: number; valid: number; newGroups: number; duplicates: number; invalid: number; errors: Array<{ link: string; error: string }> } {
  let valid = 0;
  let newGroups = 0;
  let duplicates = 0;
  let invalid = 0;
  const errors: Array<{ link: string; error: string }> = [];

  for (const item of links) {
    const seed: GroupSeed = typeof item === "string" ? { link: item } : item;
    const trimmed = String(seed.link || "").trim();
    if (!trimmed) continue;
    try {
      const normalized = normalizeGroupLink(trimmed);
      if (!normalized || normalized.length < 5) throw new Error("Invalid link");
      // quick validity check — must look like t.me link
      if (!/^https:\/\/t\.me\/.+/.test(normalized)) throw new Error("Not a Telegram group link");
      valid++;
      const res = upsertGroupLink({
        rawLink: trimmed,
        submittedBy: meta.submittedBy,
        submittedByEmail: meta.submittedByEmail,
        submittedByName: meta.submittedByName,
        source: meta.source,
        categoryId: meta.categoryId || null,
        groupName: seed.name || null,
        memberCount: typeof seed.memberCount === "number" ? seed.memberCount : null,
      });
      if (res.isNew) newGroups++;
      else duplicates++;
    } catch (e: any) {
      invalid++;
      errors.push({ link: trimmed, error: e.message || "Invalid" });
    }
  }
  return { total: links.length, valid, newGroups, duplicates, invalid, errors };
}

// ── Query with filters, search, sort, pagination ──
export type GroupQuery = {
  search?: string;
  categoryId?: string;
  groupType?: string;
  status?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  limit?: number;
};

export function queryGroups(q: GroupQuery): { groups: GroupRecord[]; total: number; page: number; limit: number; totalPages: number } {
  let all = getGroups();

  // search
  if (q.search) {
    const s = q.search.toLowerCase().trim();
    all = all.filter(
      (g) =>
        (g.group_name || "").toLowerCase().includes(s) ||
        (g.group_username || "").toLowerCase().includes(s) ||
        g.group_link.toLowerCase().includes(s) ||
        g.normalized_link.toLowerCase().includes(s) ||
        g.submitted_by_email.toLowerCase().includes(s) ||
        g.submitted_by_name.toLowerCase().includes(s) ||
        (g.notes || "").toLowerCase().includes(s) ||
        (g.admin_notes || "").toLowerCase().includes(s) ||
        g.category_name.toLowerCase().includes(s)
    );
  }
  if (q.categoryId) all = all.filter((g) => g.category_id === q.categoryId);
  if (q.groupType) all = all.filter((g) => g.group_type === q.groupType);
  if (q.status) all = all.filter((g) => g.status === q.status);
  if (q.source) all = all.filter((g) => g.source === q.source);
  if (q.dateFrom) {
    const from = new Date(q.dateFrom).getTime();
    all = all.filter((g) => new Date(g.first_added_at).getTime() >= from);
  }
  if (q.dateTo) {
    const to = new Date(q.dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
    all = all.filter((g) => new Date(g.first_added_at).getTime() <= to);
  }

  // sort
  const sortBy = q.sortBy || "first_added_at";
  const dir = q.sortDir === "asc" ? 1 : -1;
  all.sort((a: any, b: any) => {
    let av = a[sortBy];
    let bv = b[sortBy];
    if (sortBy.includes("at") || sortBy === "updated_at") {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    }
    if (av == null) av = "";
    if (bv == null) bv = "";
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const total = all.length;
  const page = Math.max(1, q.page || 1);
  const limit = Math.min(100, Math.max(1, q.limit || 20));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const groups = all.slice(start, start + limit);

  return { groups, total, page, limit, totalPages };
}

export function getGroupStats(): { total: number; byCategory: Array<{ id: string; name: string; count: number; color: string }>; byStatus: Record<string, number>; byType: Record<string, number>; bySource: Record<string, number>; totalMembers: number; withMembers: number } {
  const groups = getGroups();
  const cats = getCategories();
  const byCategory = cats.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    count: groups.filter((g) => g.category_id === c.id).length,
  }));
  // include Uncategorized if missing
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const g of groups) {
    byStatus[g.status] = (byStatus[g.status] || 0) + 1;
    byType[g.group_type] = (byType[g.group_type] || 0) + 1;
    bySource[g.source] = (bySource[g.source] || 0) + 1;
  }
  // Total known members across active groups (only groups with a resolved count)
  const totalMembers = groups
    .filter((g) => g.status === "active" && typeof (g as any).member_count === "number")
    .reduce((sum, g) => sum + ((g as any).member_count || 0), 0);
  const withMembers = groups.filter(
    (g) => g.status === "active" && typeof (g as any).member_count === "number"
  ).length;
  return { total: groups.length, byCategory, byStatus, byType, bySource, totalMembers, withMembers };
}
