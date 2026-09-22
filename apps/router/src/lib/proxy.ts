import { createProxyMiddleware, fixRequestBody, type RequestHandler } from 'http-proxy-middleware';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Service } from '@lumora/types';
import { logger } from './logger.js';

// Cache proxy instances per service ID to avoid recreation on every request
const proxyCache = new Map<string, RequestHandler>();

export function getServiceProxy(service: Service): RequestHandler {
  const cached = proxyCache.get(service.id);
  if (cached) return cached;

  const target = new URL(service.upstreamUrl);
  const baseTarget = `${target.protocol}//${target.host}`;
  const pathSuffix = target.pathname;

  // No on.error handler here — gateway.ts handles errors via the next() callback
  // to avoid sending a double response (proxy on.error + next() both firing).
  const proxy = createProxyMiddleware({
    target: baseTarget,
    changeOrigin: true,
    pathRewrite: () => pathSuffix,
    on: {
      // express.json() has already consumed and parsed the request stream by
      // the time this middleware runs, so the raw body must be re-serialized
      // onto the proxied request — otherwise a paid POST reaches upstream
      // with an empty (or hanging) body.
      proxyReq: (proxyReq: ClientRequest, req: IncomingMessage) => {
        fixRequestBody(proxyReq, req);
      },
      error: (err: unknown, _req: unknown, _res: unknown, next: unknown) => {
        logger.error({ err, serviceId: service.id }, 'Proxy upstream error');
        // Call next(err) so Express error handler responds — do NOT write to res here
        if (typeof next === 'function') (next as (e: unknown) => void)(err);
      },
    },
  });

  proxyCache.set(service.id, proxy);
  return proxy;
}

/** Remove a service's cached proxy (call after service is deleted/updated). */
export function evictProxyCache(serviceId: string): void {
  proxyCache.delete(serviceId);
}
