import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne } from '@8xtel/core';
import { ROLE_PERMISSIONS, RoleName } from '@8xtel/core';

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const EXPIRES = process.env.JWT_EXPIRES_IN ?? '12h';

export interface AuthUser {
  id: string;
  email: string;
  role: RoleName;
  permissions: string[];
  /** 'console' (staff) or 'portal' (client self-service). Portal tokens are
      only accepted on /portal/* routes and carry client_id instead of perms. */
  kind?: 'console' | 'portal';
  client_id?: string;
  client_name?: string;
}

export async function verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
  const row = await queryOne<{
    id: string; email: string; password_hash: string; role: RoleName; is_active: boolean;
  }>(
    `SELECT u.id, u.email, u.password_hash, r.name AS role, u.is_active
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`,
    [email.toLowerCase()],
  );
  if (!row || !row.is_active) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    permissions: ROLE_PERMISSIONS[row.role] ?? [],
  };
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, permissions: user.permissions },
    SECRET,
    { expiresIn: EXPIRES } as jwt.SignOptions,
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const p = jwt.verify(token, SECRET) as {
      sub: string; email: string; role: RoleName; permissions: string[];
      kind?: 'console' | 'portal'; client_id?: string; client_name?: string;
    };
    return {
      id: p.sub, email: p.email, role: p.role, permissions: p.permissions ?? [],
      kind: p.kind ?? 'console', client_id: p.client_id, client_name: p.client_name,
    };
  } catch {
    return null;
  }
}

/** Client portal login (§4): email + password on the clients table. */
export async function verifyPortalCredentials(email: string, password: string): Promise<AuthUser | null> {
  const row = await queryOne<{
    id: string; name: string; portal_email: string; portal_password_hash: string;
    status: string; portal_enabled: boolean; is_house: boolean;
  }>(
    `SELECT id, name, portal_email, portal_password_hash, status, portal_enabled,
            COALESCE(is_house,false) AS is_house
     FROM clients WHERE lower(portal_email)=lower($1)`,
    [email.toLowerCase()],
  );
  if (!row || !row.portal_password_hash || !row.portal_enabled) return null;
  if (row.is_house || row.status !== 'active') return null;
  const ok = await bcrypt.compare(password, row.portal_password_hash);
  if (!ok) return null;
  return {
    id: row.id,
    email: row.portal_email,
    role: 'read_only',
    permissions: [],
    kind: 'portal',
    client_id: row.id,
    client_name: row.name,
  };
}

export function signPortalToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: 'portal', permissions: [], kind: 'portal', client_id: user.client_id, client_name: user.client_name },
    SECRET,
    { expiresIn: EXPIRES } as jwt.SignOptions,
  );
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
