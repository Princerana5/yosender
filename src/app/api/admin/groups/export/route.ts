import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin";
import { getGroups, getCategories } from "@/lib/groups-db";
import { buildXlsx, groupToRow, GROUP_EXPORT_HEADERS } from "@/lib/excel";

// GET /api/admin/groups/export?scope=all|category|selected|by-category
//   &categoryId=xxx&ids=a,b,c&format=xlsx|txt
// format=txt → plain text, 1 group link per line (re-importable via Import).
// Default xlsx → real Excel workbook (built with the xlsx lib).
export async function GET(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "all";
  const format = (url.searchParams.get("format") || "xlsx").toLowerCase();
  const categoryId = url.searchParams.get("categoryId") || url.searchParams.get("category_id");
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const all = getGroups();
  const cats = getCategories();
  const stamp = new Date().toISOString().slice(0, 10);

  const asTxt = (groups: any[], filename: string) => {
    const lines = [...new Set(groups.map((g) => String(g.group_link || g.normalized_link || "").trim()).filter(Boolean))];
    return new NextResponse(lines.join("\n") + (lines.length ? "\n" : ""), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  };

  // Export All Categories → separate worksheet per category + All Groups sheet
  if (scope === "by-category" || url.searchParams.get("allCategories") === "1") {
    if (format === "txt" || format === "text") return asTxt(all, `groups-all-categories-${stamp}.txt`);
    const sheets = [
      {
        name: "All Groups",
        headers: GROUP_EXPORT_HEADERS,
        rows: all.map(groupToRow),
        colWidths: [24, 36, 36, 10, 18, 16, 10, 10, 18, 24, 20, 20, 24, 24],
      },
    ];
    for (const c of cats) {
      const rows = all.filter((g) => g.category_id === c.id).map(groupToRow);
      if (!rows.length) continue;
      sheets.push({
        name: c.name,
        headers: GROUP_EXPORT_HEADERS,
        rows,
        colWidths: [24, 36, 36, 10, 18, 16, 10, 10, 18, 24, 20, 20, 24, 24],
      });
    }
    const buf = buildXlsx(sheets);
    return new NextResponse(Buffer.from(buf.buffer as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="groups-all-categories-${stamp}.xlsx"`,
      },
    });
  }

  let filtered = all;
  let base = `groups-all-${stamp}`;

  if (scope === "category" && categoryId) {
    const cat = cats.find((c) => c.id === categoryId);
    if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    filtered = all.filter((g) => g.category_id === categoryId);
    base = `groups-${cat.slug}-${stamp}`;
  } else if (scope === "selected" && ids.length) {
    const set = new Set(ids);
    filtered = all.filter((g) => set.has(g.id));
    base = `groups-selected-${ids.length}-${stamp}`;
  }

  if (format === "txt" || format === "text") {
    const sheetName = scope === "category" ? (cats.find((c) => c.id === categoryId)?.name || "Category") : scope === "selected" ? "Selected Groups" : "All Groups";
    void sheetName;
    return asTxt(filtered, `${base}.txt`);
  }

  const sheetName = scope === "category" ? (cats.find((c) => c.id === categoryId)?.name || "Category") : scope === "selected" ? "Selected Groups" : "All Groups";
  const buf = buildXlsx([
    {
      name: sheetName,
      headers: GROUP_EXPORT_HEADERS,
      rows: filtered.map(groupToRow),
      colWidths: [24, 36, 36, 10, 18, 16, 10, 10, 18, 24, 20, 20, 24, 24],
    },
  ]);

  return new NextResponse(Buffer.from(buf.buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
