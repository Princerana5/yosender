import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, hasPerm } from "@/lib/admin";
import { getUsers, saveUsers, getAccounts, getCampaigns } from "@/lib/db";
import { getActiveSubscription } from "@/lib/subscriptions";
import { getPlan } from "@/lib/plans";
import bcrypt from "bcryptjs";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "users")) return NextResponse.json({ error: "No permission: users" }, { status: 403 });
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const filter = url.searchParams.get("filter") || "all";

  const allUsers = getUsers();
  let filtered = allUsers;
  if (search) {
    filtered = filtered.filter(u => u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search));
  }
  if (filter === "banned") filtered = filtered.filter((u: any) => u.isBanned);
  else if (filter === "active") filtered = filtered.filter((u: any) => !u.isBanned);

  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = filtered.length;
  const start = (page - 1) * limit;
  const pageUsers = filtered.slice(start, start + limit);

  const enriched = pageUsers.map(u => {
    const userAccounts = getAccounts().filter(a => a.userId === u.id);
    const sub = getActiveSubscription(u.id);
    const plan = sub ? getPlan(sub.planId) : null;
    const campaigns = getCampaigns().filter(c => c.userId === u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      telegramUsername: u.telegramUsername || "",
      createdAt: u.createdAt,
      lastLoginAt: (u as any).lastLoginAt || "Never",
      isBanned: (u as any).isBanned || false,
      emailVerified: (u as any).emailVerified !== false,
      authMethod: !(u as any).passwordHash ? "Google" : (u as any).googleId ? "Both" : "Email",
      tgAccounts: userAccounts.length,
      plan: plan?.name || "None",
      planId: sub?.planId || null,
      billing: sub?.billing || null,
      expiresAt: sub?.expiresAt || null,
      campaignsCount: campaigns.length,
      totalSent: campaigns.reduce((a, c) => a + (c.successful || 0), 0),
    };
  });

  return NextResponse.json({ users: enriched, total, page, limit, totalPages: Math.ceil(total / limit) });
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "users")) return NextResponse.json({ error: "No permission: users" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "");
  const users = getUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (action === "ban") {
    (users[idx] as any).isBanned = true;
    saveUsers(users);
    return NextResponse.json({ ok: true, user: users[idx] });
  }
  if (action === "unban") {
    (users[idx] as any).isBanned = false;
    saveUsers(users);
    return NextResponse.json({ ok: true, user: users[idx] });
  }
  if (action === "reset_password") {
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 6) return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });
    const hash = await bcrypt.hash(newPassword, 10);
    users[idx].passwordHash = hash;
    saveUsers(users);
    return NextResponse.json({ ok: true, message: "Password reset" });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!hasPerm(req, "users")) return NextResponse.json({ error: "No permission: users" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const users = getUsers();
  const filtered = users.filter(u => u.id !== id);
  if (filtered.length === users.length) return NextResponse.json({ error: "User not found" }, { status: 404 });
  saveUsers(filtered);
  return NextResponse.json({ ok: true });
}
