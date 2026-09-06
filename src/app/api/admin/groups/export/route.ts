import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/admin";
import { getGroups, getCategories } from "@/lib/groups-db";
import { buildXlsx, groupToRow, GROUP_EXPORT_HEADERS } from "@/lib/excel";

// GET /api/admin/groups/export?scope=all|category|selected&categoryId=xxx&ids=a,b,c
export async function GET(req: NextRequest) {
  const perm = requirePerm(req, "groups");
  if (!perm.ok) return perm.res;

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "all";
  const categoryId = url.searchParams.get("categoryId") || url.searchParams.get("category_id");
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const all = getGroups();
  const cats = getCategories();

  // Export All Categories → separate worksheet per category + All Groups sheet
  if (scope === "by-category" || url.searchParams.get("allCategories") === "1") {
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
        "Content-Disposition": `attachment; filename="groups-all-categories-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  }

  let filtered = all;
  let filename = `groups-all-${new Date().toISOString().slice(0, 10)}.xlsx`;
  let sheetName = "All Groups";

  if (scope === "category" && categoryId) {
    const cat = cats.find((c) => c.id === categoryId);
    if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    filtered = all.filter((g) => g.category_id === categoryId);
    filename = `groups-${cat.slug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    sheetName = cat.name;
  } else if (scope === "selected" && ids.length) {
    const set = new Set(ids);
    filtered = all.filter((g) => set.has(g.id));
    filename = `groups-selected-${ids.length}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    sheetName = "Selected Groups";
  }

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
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
