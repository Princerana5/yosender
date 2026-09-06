import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, isOwnerAdmin, hasPerm, getRequestEmail } from "@/lib/admin";
import { getTeam, saveTeam, getTeamMemberByEmail, normalizePerms, ALL_PERMS, PERM_LABELS, type TeamMember } from "@/lib/team";
import { getUsers } from "@/lib/db";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  // team tab requires team perm (or owner)
  if (!hasPerm(req, "team")) return NextResponse.json({ error: "No permission: team" }, { status: 403 });
  const team = getTeam().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const email = getRequestEmail(req);
  const isOwner = isOwnerAdmin(req);
  return NextResponse.json({ team, allPerms: ALL_PERMS, permLabels: PERM_LABELS, isOwner, myEmail: email });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "team")) return NextResponse.json({ error: "No permission: team" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const permissions = normalizePerms(body.permissions || []);

  if (!email || !email.includes("@")) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!permissions.length) return NextResponse.json({ error: "At least one permission required" }, { status: 400 });

  const existing = getTeamMemberByEmail(email);
  if (existing) return NextResponse.json({ error: "Email already invited/active" }, { status: 409 });

  // prevent inviting an owner admin as team (they already have full access)
  const { getAdminEmails } = await import("@/lib/admin");
  if (getAdminEmails().includes(email)) return NextResponse.json({ error: "This email is already an owner admin (full access)" }, { status: 409 });

  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === email);

  const adminId = (() => {
    try {
      const t = req.cookies.get("auth_token")?.value;
      if (!t) return null;
      const { verifyToken } = require("@/lib/auth");
      return (verifyToken(t) as any)?.id || null;
    } catch { return null; }
  })();

  const inviteCode = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();

  const member: TeamMember = {
    id: `team_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    email,
    name: name || (user?.name || email.split("@")[0]),
    role: user ? "member" : "pending",
    permissions,
    status: "active",
    invitedBy: adminId,
    createdAt: now,
    updatedAt: now,
  };

  const team = getTeam();
  team.unshift(member);
  saveTeam(team);

  return NextResponse.json({ ok: true, member, inviteUrl: `/team/accept?code=${inviteCode}` });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "team")) return NextResponse.json({ error: "No permission: team" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "");
  const team = getTeam();
  const idx = team.findIndex(m => m.id === id);

  if (idx === -1) return NextResponse.json({ error: "Team member not found" }, { status: 404 });

  if (action === "update_perms") {
    const permissions = normalizePerms(body.permissions || []);
    if (!permissions.length) return NextResponse.json({ error: "At least one permission required" }, { status: 400 });
    team[idx].permissions = permissions;
    team[idx].updatedAt = new Date().toISOString();
    saveTeam(team);
    return NextResponse.json({ ok: true, member: team[idx] });
  }

  if (action === "revoke") {
    team[idx].status = "revoked";
    team[idx].updatedAt = new Date().toISOString();
    saveTeam(team);
    return NextResponse.json({ ok: true, member: team[idx] });
  }

  if (action === "reinstate") {
    team[idx].status = "active";
    team[idx].updatedAt = new Date().toISOString();
    saveTeam(team);
    return NextResponse.json({ ok: true, member: team[idx] });
  }

  if (action === "delete") {
    team.splice(idx, 1);
    saveTeam(team);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "team")) return NextResponse.json({ error: "No permission: team" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const team = getTeam();
  const idx = team.findIndex(m => m.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  team.splice(idx, 1);
  saveTeam(team);
  return NextResponse.json({ ok: true });
}
