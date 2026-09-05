import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Public metadata: groups + categories */
export async function GET() {
  const d = db();
  return NextResponse.json({
    groups: d.groups.filter((g) => g.active).sort((a, b) => a.order - b.order),
    categories: d.categories,
  });
}
