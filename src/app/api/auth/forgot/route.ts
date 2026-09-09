import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/db";
import { makeOtp, sendOtpEmail, emailConfigured } from "@/lib/email";

const OTP_TTL_MS = 10 * 60 * 1000;

// POST /api/auth/forgot — { email } → emails a 6-digit OTP (10 min).
// The old long-token link flow is replaced: the UI now collects the OTP +
// new password and calls /api/auth/reset with { email, code, newPassword }.
export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));
  if (!email || !String(email).includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  const users = getUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === String(email).toLowerCase().trim());
  // Always respond the same way so emails can't be enumerated.
  if (idx === -1) {
    return NextResponse.json({ ok: true, message: "If an account exists for this email, a reset code was sent." });
  }
  const code = makeOtp();
  (users[idx] as any).resetOtp = code;
  (users[idx] as any).resetOtpExpires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  // Drop any legacy long-token so only the OTP path works.
  delete (users[idx] as any).resetToken;
  delete (users[idx] as any).resetExpires;
  saveUsers(users);
  const { sent, error } = await sendOtpEmail(String(email).trim(), code, "reset");
  const res: any = { ok: true, message: sent ? "Reset code sent to your email." : "Email service is being set up — use this code for now." };
  if (!emailConfigured()) res.devOtp = code;
  if (!sent && emailConfigured()) res.emailError = error;
  return NextResponse.json(res);
}
