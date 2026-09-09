import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, saveUsers } from "@/lib/db";

// POST /api/auth/reset — { email, code, newPassword } → verifies the OTP
// from /api/auth/forgot and sets the new password. Legacy { token } payloads
// are rejected with a clear message (re-request via the new OTP flow).
export async function POST(req: NextRequest) {
  const { email, code, newPassword, token } = await req.json().catch(() => ({}));
  if (token && !code) {
    return NextResponse.json({ error: "Reset links are retired — request a fresh email code and try again." }, { status: 400 });
  }
  if (!email || !code || !newPassword) {
    return NextResponse.json({ error: "Email, code and new password required" }, { status: 400 });
  }
  if (String(newPassword).length < 6) {
    return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });
  }
  const users = getUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === String(email).toLowerCase().trim());
  if (idx === -1) {
    return NextResponse.json({ error: "Invalid code — request a new one." }, { status: 400 });
  }
  const u = users[idx] as any;
  if (!u.resetOtp || String(code).trim() !== String(u.resetOtp)) {
    return NextResponse.json({ error: "Wrong code — check your email and try again." }, { status: 400 });
  }
  if (!u.resetOtpExpires || new Date(u.resetOtpExpires).getTime() < Date.now()) {
    delete u.resetOtp; delete u.resetOtpExpires; saveUsers(users);
    return NextResponse.json({ error: "Code expired — request a new one." }, { status: 400 });
  }
  users[idx].passwordHash = await bcrypt.hash(String(newPassword), 10);
  delete u.resetOtp; delete u.resetOtpExpires;
  saveUsers(users);
  return NextResponse.json({ ok: true, message: "Password updated — sign in now." });
}
