import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { insertService, deleteService, listServices } from '../db/queries/services.js';
import { evictProxyCache } from '../lib/proxy.js';

const router = Router();

// Compares two strings in constant time by hashing both to equal-length
// digests first. Comparing raw buffers of unequal length directly would
// leak length information and can throw in timingSafeEqual.
function timingSafeEqualStrings(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// Auth middleware for admin routes
router.use((req, res, next) => {
  const apiKey = req.headers['x-admin-key'];
  if (typeof apiKey !== 'string' || !timingSafeEqualStrings(apiKey, config.ADMIN_API_KEY)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

const registerSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  upstreamUrl: z.string().url(),
  method: z.enum(['GET', 'POST']).optional(),
  priceUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
  priceXlm: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

router.post('/admin/services', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  try {
    const service = insertService(parsed.data);
    res.status(201).json({ service });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      res.status(409).json({ error: 'Service ID already exists' });
      return;
    }
    throw err;
  }
});

router.delete('/admin/services/:id', (req, res) => {
  const id = req.params['id']!;
  const deleted = deleteService(id);
  if (!deleted) {
    res.status(404).json({ error: 'Service not found' });
    return;
  }
  evictProxyCache(id);
  res.json({ ok: true });
});

router.get('/admin/services', (_req, res) => {
  const services = listServices(false);
  res.json({ services });
});

export default router;
