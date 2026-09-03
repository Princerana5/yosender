import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, isOwnerAdmin, getRequestEmail } from "@/lib/admin";
import { getTeamMemberByEmail, ALL_PERMS } from "@/lib/team";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const email = getRequestEmail(req);
  const isOwner = isOwnerAdmin(req);
  const member = getTeamMemberByEmail(email);
  const permissions: string[] = isOwner ? [...ALL_PERMS] : (member?.permissions || []);
  return NextResponse.json({ email, isOwner, permissions, allPerms: ALL_PERMS });
}
