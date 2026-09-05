import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

export const COOKIE = "nevx_session";

const SECRET = new TextEncoder().encode(
  process.env.NEVX_SECRET || "nevx-dev-secret-change-me-in-production"
);

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function signSession(userId: string, role: string): Promise<string> {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET);
}

export async function verifyToken(
  token: string
): Promise<{ sub: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, role: String(payload.role || "USER") };
  } catch {
    return null;
  }
}

export interface Session {
  id: string;
  role: string;
}

export async function currentSession(): Promise<Session | null> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const v = await verifyToken(token);
  if (!v) return null;
  return { id: v.sub, role: v.role };
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    7 * 24 * 3600
  }`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
