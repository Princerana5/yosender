import { Request, Response, NextFunction } from 'express';
import { can } from '@8xtel/core';
import { verifyToken, AuthUser } from './auth.js';
import { getPool } from '@8xtel/core';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** JWT auth (§32) */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'missing token' });
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'invalid or expired token' });
    return;
  }
  req.user = user;
  next();
}

/** RBAC gate (§30). Portal tokens are NEVER accepted on console routes —
    clients get /portal/* only, even if they guess an admin URL. */
export function requirePerm(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.kind === 'portal' || !can(req.user.permissions, permission)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/** Portal gate (§4): accepts ONLY portal tokens, scopes to own client_id. */
export function requirePortal(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.kind !== 'portal' || !req.user.client_id) {
    res.status(403).json({ error: 'portal login required' });
    return;
  }
  next();
}

/** Audit every mutating admin action (§31) */
export function audit(action: string, objectType: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await getPool().query(
        `INSERT INTO audit_logs (actor_id, actor_email, action, object_type, object_id, new_value, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.user?.id ?? null,
          req.user?.email ?? null,
          action,
          objectType,
          (req.params as Record<string, string>).id ?? null,
          req.body ?? null,
          req.ip,
        ],
      );
    } catch (e) {
      console.error('[audit]', (e as Error).message);
    }
    next();
  };
}
