import { NextRequest, NextResponse } from "next/server";

function getAppUrl(req: NextRequest) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    const appUrl = getAppUrl(req);
    const redirectUri = `${appUrl}/api/auth/google/callback`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google OAuth not configured</title></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:24px;line-height:1.6"><h1 style="font-size:20px">Google sign-in not configured</h1><p style="color:#475569">Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in <code>.env.local</code> and add this redirect URI in Google Cloud Console:</p><code style="display:block;background:#f1f5f9;padding:12px;border-radius:12px;word-break:break-all">${redirectUri}</code><p style="color:#64748b;font-size:13px;margin-top:12px">Create credentials at <a href="https://console.cloud.google.com/apis/credentials">console.cloud.google.com/apis/credentials</a> → Create OAuth client ID (Web application) → Authorized redirect URIs.</p><a href="${appUrl}" style="display:inline-block;margin-top:16px;background:#229ED9;color:#fff;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600">Back to home</a></body></html>`;
    return new NextResponse(html, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const appUrl = getAppUrl(req);
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  // CSRF protection — random state stored in httpOnly cookie
  const state =
    (globalThis.crypto as any)?.randomUUID?.() ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "offline",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
