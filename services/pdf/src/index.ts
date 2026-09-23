import Fastify from 'fastify';
import { extractTextRoute } from './routes/extract-text.js';
import { toJsonRoute } from './routes/to-json.js';
import { logger } from './lib/logger.js';
import { assertInternalKeyConfigured, requireInternalKey } from './lib/internal-auth.js';

const PORT = parseInt(process.env['PDF_SERVICE_PORT'] ?? '3002', 10);
const isDevelopment = process.env['NODE_ENV'] === 'development';
const PDF_INTERNAL_KEY = process.env['PDF_INTERNAL_KEY'];

try {
  assertInternalKeyConfigured(PDF_INTERNAL_KEY, isDevelopment);
} catch (err) {
  logger.error(err);
  process.exit(1);
}

const fastify = Fastify({
  logger: false, // using pino directly
  bodyLimit: 50 * 1024 * 1024, // 50MB for large PDFs
});

fastify.addHook('onRequest', requireInternalKey(PDF_INTERNAL_KEY));

await fastify.register(extractTextRoute);
await fastify.register(toJsonRoute);

fastify.get('/health', async () => ({ status: 'ok' }));

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  logger.info({ port: PORT }, 'Lumora PDF Service started');
} catch (err) {
  logger.error(err);
  process.exit(1);
}
