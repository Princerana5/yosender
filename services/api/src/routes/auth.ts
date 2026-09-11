import { Router } from 'express';
import { z } from 'zod';
import { verifyCredentials, signToken } from '../auth.js';
import { getPool } from '@8xtel/core';

const router = Router();

router.post('/login', async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const user = await verifyCredentials(body.data.email, body.data.password);
  if (!user) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  await getPool().query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  res.json({ token: signToken(user), user: { id: user.id, email: user.email, role: user.role, permissions: user.permissions } });
});

router.get('/me', async (req, res) => {
  res.json({ user: (req as unknown as { user: unknown }).user ?? null });
});

export default router;
