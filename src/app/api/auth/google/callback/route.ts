import { NextRequest, NextResponse } from "next/server";
import { getUsers, saveUsers } from "@/lib/db";
import { signToken } from "@/lib/auth";

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

function htmlError(title: string, msg: string, appUrl: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:24px"><h1 style="font-size:20px">${title}</h1><p style="color:#475569;line-height:1.6">${msg}</p><a href="${appUrl}" style="display:inline-block;margin-top:16px;background:#229ED9;color:#fff;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600">Back to home</a></body></html>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const appUrl = getAppUrl(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlError("Google sign-in cancelled", `Google returned: ${error}. Please try again.`, appUrl);
  }
  if (!code) return htmlError("Missing code", "No authorization code returned from Google.", appUrl);

  // CSRF check
  const expectedState = req.cookies.get("google_oauth_state")?.value;
  if (!expectedState || !state || state !== expectedState) {
    return htmlError("Invalid state", "State mismatch — please try signing in again. (CSRF protection)", appUrl);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return htmlError(
      "Google OAuth not configured",
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local and add the redirect URI to Google Cloud Console: " +
        appUrl +
        "/api/auth/google/callback",
      appUrl
    );
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`;

  // Exchange code for tokens
  let tokenJson: any;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const text = await tokenRes.text();
    try {
      tokenJson = JSON.parse(text);
    } catch {
      return htmlError("Token exchange failed", text.slice(0, 500), appUrl);
    }
    if (!tokenRes.ok) {
      return htmlError("Token exchange failed", tokenJson.error_description || tokenJson.error || text.slice(0, 500), appUrl);
    }
  } catch (e: any) {
    return htmlError("Token exchange failed", e.message, appUrl);
  }

  const accessToken = tokenJson.access_token;
  const idToken = tokenJson.id_token;
  if (!accessToken && !idToken) return htmlError("No token", "Google did not return an access token.", appUrl);

  // Fetch user info — prefer userinfo endpoint with access_token, fallback to id_token decode
  let profile: any = null;
  try {
    if (accessToken) {
      const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok) profile = await r.json();
    }
    // fallback: decode id_token payload (no verification needed for basic profile — we already validated via token exchange)
    if (!profile?.email && idToken) {
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString());
      profile = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        verified_email: payload.email_verified,
      };
    }
  } catch (e: any) {
    return htmlError("Failed to fetch profile", e.message, appUrl);
  }

  const email = String(profile?.email || "").toLowerCase().trim();
  const name = String(profile?.name || profile?.given_name || email.split("@")[0] || "User").trim();
  const googleId = String(profile?.id || profile?.sub || "").trim();
  const picture = String(profile?.picture || "").trim();

  if (!email) return htmlError("No email", "Google account did not return an email address. Is email scope granted?", appUrl);
  if (profile?.verified_email === false) return htmlError("Email not verified", "Please verify your Google email first.", appUrl);

  // Find or create user
  const users = getUsers();
  let user = users.find((u) => u.email.toLowerCase() === email);
  // also check by googleId if email changed
  if (!user && googleId) user = users.find((u) => (u as any).googleId === googleId) as any;

  if (user && (user as any).isBanned) {
    return htmlError("Account banned", "This account has been banned — contact support.", appUrl);
  }

  if (!user) {
    const newUser: any = {
      id: (globalThis.crypto as any)?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`,
      name,
      email,
      // Google users have no password — store empty hash; login via password will fail (bcrypt compare will be false)
      passwordHash: "",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      googleId: googleId || undefined,
      avatar: picture || undefined,
      emailVerified: true,
    };
    users.push(newUser);
    saveUsers(users);
    user = newUser;
  } else {
    // link Google if not linked, update profile
    let changed = false;
    if (googleId && !(user as any).googleId) { (user as any).googleId = googleId; changed = true; }
    if (picture && !(user as any).avatar) { (user as any).avatar = picture; changed = true; }
    if (!(user as any).emailVerified) { (user as any).emailVerified = true; changed = true; }
    (user as any).lastLoginAt = new Date().toISOString();
    changed = true;
    if (changed) saveUsers(users);
  }

  const token = signToken({ id: (user as any).id, email: (user as any).email, name: (user as any).name });

  const res = NextResponse.redirect(`${appUrl}/?google=success`);
  res.cookies.set("auth_token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
  // clear state cookie
  res.cookies.set("google_oauth_state", "", { maxAge: 0, path: "/" });
  return res;
}
