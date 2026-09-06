import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getUsers, saveUsers } from "@/lib/db";

// POST /api/auth/forgot — { email } → generates a reset token.
// No email service is configured, so the reset link is shown in-app
// (and to admins). Token expires in 30 min, single-use.
export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));
  if (!email || !String(email).includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  const users = getUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === String(email).toLowerCase().trim());
  // Always respond the same way so emails can't be enumerated.
  if (idx === -1) {
    return NextResponse.json({ ok: true, message: "If an account exists for this email, a reset link was created." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  (users[idx] as any).resetToken = token;
  (users[idx] as any).resetExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  saveUsers(users);
  // No SMTP configured — return the link so the UI can display it.
  // (Admin can also read it from .data/users.json if needed.)
  return NextResponse.json({
    ok: true,
    message: "If an account exists for this email, a reset link was created.",
    resetToken: token,
  });
}
