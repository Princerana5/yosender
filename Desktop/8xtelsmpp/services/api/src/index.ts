import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './middleware.js';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import vendorRoutes from './routes/vendors.js';
import routeRoutes from './routes/routes.js';
import messageRoutes from './routes/messages.js';
import billingRoutes from './routes/billing.js';
import reportRoutes from './routes/reports.js';
import systemRoutes from './routes/system.js';

const app = express();
const PORT = Number(process.env.API_PORT ?? 8080);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 600 })); // §32

// Public
app.use('/auth', authRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: '8xtelSMPP-api' }));

// OpenAPI (§33)
try {
  const doc = parseYaml(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'openapi.yaml'), 'utf8'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(doc));
  app.get('/openapi.yaml', (_req, res) => res.sendFile(join(dirname(fileURLToPath(import.meta.url)), 'openapi.yaml')));
} catch (e) {
  console.warn('[api] openapi not loaded:', (e as Error).message);
}

// Protected (§30 RBAC enforced per-route)
app.use('/clients', requireAuth, clientRoutes);
app.use('/vendors', requireAuth, vendorRoutes);
app.use('/routes', requireAuth, routeRoutes);
app.use('/messages', requireAuth, messageRoutes);
app.use('/billing', requireAuth, billingRoutes);
app.use('/reports', requireAuth, reportRoutes);
app.use('/system', requireAuth, systemRoutes);

// Channel connectors (§23)
app.use('/connectors', requireAuth, (await import('./routes/connectors.js')).default);

// 404 + error
app.use((_req, res) => res.status(404).json({ error: 'not found' }));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api]', err.message);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, () => console.log(`[8xtelSMPP api] listening on :${PORT}`));
