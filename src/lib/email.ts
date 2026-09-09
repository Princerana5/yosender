import nodemailer from "nodemailer";

// Gmail SMTP sender for OTP emails (signup verify + password reset).
// Config (in .env.local):
//   SMTP_USER=you@gmail.com            — the Gmail address mails come FROM
//   SMTP_PASS=xxxx xxxx xxxx xxxx      — a Gmail APP PASSWORD (not your login
//                                        password): Google Account → Security →
//                                        2-Step Verification → App passwords.
// Missing config = dev fallback: OTP is returned in the API response so local
// testing and the UI still work; production MUST set these.
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter(): ReturnType<typeof nodemailer.createTransport> | null {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

export function emailConfigured(): boolean {
  return !!process.env.SMTP_USER?.trim() && !!process.env.SMTP_PASS?.trim();
}

function otpHtml(code: string, purpose: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0F172A">
<div style="text-align:center;font-weight:800;font-size:20px">Yosender</div>
<p style="color:#475569;font-size:14px;text-align:center">${purpose}</p>
<div style="text-align:center;font-size:36px;font-weight:800;letter-spacing:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:16px;padding:20px 12px;margin:20px 0">${code}</div>
<p style="color:#94A3B8;font-size:12px;text-align:center">Valid for 10 minutes. Never share this code with anyone.</p>
</body></html>`;
}

export async function sendOtpEmail(to: string, code: string, kind: "signup" | "reset"): Promise<{ sent: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) return { sent: false, error: "Email not configured" };
  try {
    await t.sendMail({
      from: `"Yosender" <${process.env.SMTP_USER!.trim()}>`,
      to,
      subject: kind === "signup" ? `Your Yosender verification code: ${code}` : `Reset your Yosender password: ${code}`,
      html: otpHtml(code, kind === "signup" ? "Enter this code to verify your email and finish creating your account." : "Enter this code to reset your password."),
    });
    return { sent: true };
  } catch (e: any) {
    return { sent: false, error: e?.message || "Send failed" };
  }
}

export function makeOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
