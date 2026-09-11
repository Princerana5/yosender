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
    };
    return { id: p.sub, email: p.email, role: p.role, permissions: p.permissions ?? [] };
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
