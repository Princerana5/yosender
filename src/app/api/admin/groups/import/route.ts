import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin";
import { bulkUpsertGroupLinks, getCategoryById } from "@/lib/groups-db";
import { verifyToken } from "@/lib/auth";
import { getUsers } from "@/lib/db";

function getUserFromReq(req: NextRequest) {
  const t = req.cookies.get("auth_token")?.value;
  const p = t ? (verifyToken(t) as any) : null;
  if (!p?.id) return null;
  return getUsers().find((u) => u.id === p.id) || null;
}

// Extract candidate links from uploaded file content.
// Supports: .xlsx (parse sharedStrings + sheet XML), .csv / .txt (split lines/commas)
function extractLinksFromXlsx(buf: Buffer): string[] {
  const links: string[] = [];
  try {
    const text = buf.toString("latin1");
    // Grab all <t>...</t> text nodes (sharedStrings + inlineStr)
    const tMatches = text.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
    for (const m of tMatches) {
      const inner = m.replace(/<\/?t[^>]*>/g, "").trim();
      if (!inner) continue;
      // split on whitespace/commas, keep tokens that look like links
      const parts = inner.split(/[\s,;|]+/);
      for (const p of parts) {
        const c = p.trim();
        if (/t\.me\//i.test(c) || /^@[\w]{3,}/.test(c)) links.push(c);
      }
    }
    // Also grab raw t.me URLs that may appear in other XML (e.g. hyperlinks)
    const urlMatches = text.match(/https?:\/\/[^\s"'<>]*t\.me\/[^\s"'<>]*/gi) || [];
    for (const u of urlMatches) {
      const clean = u.replace(/[),.;\]]+$/, "");
      if (!links.includes(clean)) links.push(clean);
    }
  } catch {}
  return [...new Set(links)];
}

function extractLinksFromText(text: string): string[] {
  const links: string[] = [];
  const parts = text.split(/[\r\n,;|]+/);
  for (const p of parts) {
    const c = p.trim().replace(/^["']+|["']+$/g, "");
    if (!c) continue;
    if (/t\.me\//i.test(c) || /^@[\w]{3,}/.test(c)) links.push(c);
    // also handle bare "Group Link" column values like https://t.me/xxx
    else if (/^https?:\/\//i.test(c) && /t\.me/i.test(c)) links.push(c);
  }
  return [...new Set(links)];
}

// POST /api/admin/groups/import — multipart form: file, category_id?
export async function POST(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;
  const user = getUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form with file" }, { status: 400 });
  }

  const file = form.get("file") as File | null;
  const categoryId = (form.get("category_id") as string) || (form.get("categoryId") as string) || null;

  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  const name = (file.name || "").toLowerCase();
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });

  let categoryName: string | null = null;
  if (categoryId) {
    const cat = getCategoryById(categoryId);
    if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    categoryName = cat.name;
  }

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);

  let links: string[] = [];
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".zip")) {
    links = extractLinksFromXlsx(buf);
  } else {
    // csv, txt — decode as utf8
    links = extractLinksFromText(buf.toString("utf-8"));
  }

  if (!links.length) {
    return NextResponse.json({
      ok: true,
      summary: { totalRows: 0, validGroups: 0, newGroups: 0, duplicates: 0, invalidLinks: 0 },
      message: "No group links found in file. Make sure it has a column with t.me links.",
      errors: [],
    });
  }

  const result = bulkUpsertGroupLinks(links, {
    submittedBy: (user as any).id,
    submittedByEmail: (user as any).email,
    submittedByName: (user as any).name || (user as any).email,
    source: "import",
    categoryId: categoryId || null,
  });

  return NextResponse.json({
    ok: true,
    summary: {
      totalRows: result.total,
      validGroups: result.valid,
      newGroups: result.newGroups,
      duplicates: result.duplicates,
      invalidLinks: result.invalid,
      assignedCategory: categoryName,
    },
    message: `Import Completed — Total: ${result.total}, Valid: ${result.valid}, New: ${result.newGroups}, Duplicates: ${result.duplicates}, Invalid: ${result.invalid}`,
    errors: result.errors.slice(0, 100),
  });
}
