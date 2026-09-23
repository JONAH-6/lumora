import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const HEADER_NAME = 'x-internal-key';

/**
 * Compares two strings for equality without leaking timing information,
 * by hashing both to a fixed length before the constant-time comparison.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Refuse to start the service without a shared secret unless we're running
 * in development, where the check is skipped entirely.
 */
export function assertInternalKeyConfigured(
  internalKey: string | undefined,
  isDevelopment: boolean,
): void {
  if (!internalKey && !isDevelopment) {
    throw new Error('PDF_INTERNAL_KEY must be set outside development mode');
  }
}

/**
 * Fastify onRequest hook that rejects any request missing a valid
 * x-internal-key header. Only the router (or another trusted internal
 * caller) should know PDF_INTERNAL_KEY, so this keeps the service from
 * being reachable directly and bypassing the router's paywall.
 */
export function requireInternalKey(internalKey: string | undefined) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.url === '/health') return;
    if (!internalKey) return; // development mode with no key configured

    const provided = request.headers[HEADER_NAME];
    if (typeof provided !== 'string' || !timingSafeCompare(provided, internalKey)) {
      await reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
  };
}
