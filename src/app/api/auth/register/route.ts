import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, saveUsers } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { makeOtp, sendOtpEmail, emailConfigured } from "@/lib/email";

const OTP_TTL_MS = 10 * 60 * 1000;

// Step 1 — POST { name, email, password, telegramUsername } → creates an
// UNVERIFIED user and emails a 6-digit OTP. The account cannot log in until
// Step 2 (verify) marks emailVerified. 11 existing users are grandfathered
// (treated as verified) so nobody gets locked out by this change.
export async function POST(req: NextRequest) {
  const { name, email, password, telegramUsername } = await req.json().catch(() => ({}));
  if (!name || !email || !password) return NextResponse.json({ error: "All fields required" }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });
  const cleanEmail = String(email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const users = getUsers();
  const existing = users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (existing && (existing as any).emailVerified) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  const passwordHash = await bcrypt.hash(String(password), 10);
  const tgUser = String(telegramUsername || "").trim().replace(/^@/, "");
  const code = makeOtp();
  const now = new Date().toISOString();
  if (existing) {
    // Re-send: refresh OTP on the unverified row instead of 409.
    (existing as any).name = String(name);
    (existing as any).passwordHash = passwordHash;
    if (tgUser) (existing as any).telegramUsername = tgUser;
    (existing as any).emailOtp = code;
    (existing as any).emailOtpExpires = new Date(Date.now() + OTP_TTL_MS).toISOString();
    saveUsers(users);
  } else {
    const user: any = {
      id: (globalThis.crypto as any)?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`,
      name: String(name), email: cleanEmail, passwordHash, createdAt: now,
      telegramUsername: tgUser || undefined,
      emailVerified: false, emailOtp: code, emailOtpExpires: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    };
    users.push(user); saveUsers(users);
  }
  const { sent, error } = await sendOtpEmail(cleanEmail, code, "signup");
  // Dev fallback (no SMTP configured): return the code so the UI can show it.
  // With SMTP set, the code NEVER leaves the server.
  const res: any = { ok: true, message: sent ? "Verification code sent to your email." : "Email service is being set up — use this code for now." };
  if (!emailConfigured()) res.devOtp = code;
  if (!sent && emailConfigured()) res.emailError = error;
  return NextResponse.json(res);
}

// Step 2 — POST { email, code } (same endpoint, action-less overload) →
// verifies the OTP, marks emailVerified, and LOGS THE USER IN.
export async function PUT(req: NextRequest) {
  const { email, code } = await req.json().catch(() => ({}));
  if (!email || !code) return NextResponse.json({ error: "Email and code required" }, { status: 400 });
  const users = getUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === String(email).toLowerCase().trim());
  if (idx === -1) return NextResponse.json({ error: "No account for this email — sign up first." }, { status: 404 });
  const u = users[idx] as any;
  if (u.emailVerified) {
    // Already verified — just log them in? No: require password login instead.
    return NextResponse.json({ error: "Email already verified — sign in with your password." }, { status: 409 });
  }
  if (!u.emailOtp || String(code).trim() !== String(u.emailOtp)) {
    return NextResponse.json({ error: "Wrong code — check your email and try again." }, { status: 400 });
  }
  if (!u.emailOtpExpires || new Date(u.emailOtpExpires).getTime() < Date.now()) {
    return NextResponse.json({ error: "Code expired — request a new one." }, { status: 400 });
  }
  u.emailVerified = true;
  delete u.emailOtp; delete u.emailOtpExpires;
  u.lastLoginAt = new Date().toISOString();
  saveUsers(users);
  const token = signToken({ id: u.id, email: u.email, name: u.name, telegramUsername: u.telegramUsername });
  const res = NextResponse.json({ ok: true, user: { id: u.id, name: u.name, email: u.email, telegramUsername: u.telegramUsername } });
  res.cookies.set("auth_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === "production" });
  return res;
}
