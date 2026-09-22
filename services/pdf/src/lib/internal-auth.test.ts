import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { assertInternalKeyConfigured, requireInternalKey } from './internal-auth.js';

async function buildApp(internalKey: string | undefined) {
  const app = Fastify();
  app.addHook('onRequest', requireInternalKey(internalKey));
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/extract-text', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('requireInternalKey', () => {
  it('rejects a request with no x-internal-key header', async () => {
    const app = await buildApp('super-secret');
    const res = await app.inject({ method: 'POST', url: '/extract-text' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a request with the wrong x-internal-key header', async () => {
    const app = await buildApp('super-secret');
    const res = await app.inject({
      method: 'POST',
      url: '/extract-text',
      headers: { 'x-internal-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a request with the correct x-internal-key header', async () => {
    const app = await buildApp('super-secret');
    const res = await app.inject({
      method: 'POST',
      url: '/extract-text',
      headers: { 'x-internal-key': 'super-secret' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('lets /health through without a header', async () => {
    const app = await buildApp('super-secret');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('assertInternalKeyConfigured', () => {
  it('throws when no key is set outside development', () => {
    expect(() => assertInternalKeyConfigured(undefined, false)).toThrow(
      /PDF_INTERNAL_KEY must be set/,
    );
  });

  it('does not throw when no key is set in development', () => {
    expect(() => assertInternalKeyConfigured(undefined, true)).not.toThrow();
  });

  it('does not throw when a key is set, regardless of environment', () => {
    expect(() => assertInternalKeyConfigured('super-secret', false)).not.toThrow();
  });
});
