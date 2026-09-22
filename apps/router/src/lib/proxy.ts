import { createProxyMiddleware, type RequestHandler } from 'http-proxy-middleware';
import type { Service } from '@lumora/types';
import { logger } from './logger.js';
import { config } from '../config.js';

// Cache proxy instances per service ID to avoid recreation on every request
const proxyCache = new Map<string, RequestHandler>();

// Hostnames the router proxies to internally (the PDF service). Requests to
// these hosts get the shared internal key so the PDF service can tell them
// apart from a client that reached it directly, bypassing the paywall.
const internalHosts = new Set(
  [process.env['PDF_SERVICE_URL'], process.env['PDF_SERVICE_URL_JSON']]
    .filter((url): url is string => Boolean(url))
    .map((url) => new URL(url).host),
);

export function getServiceProxy(service: Service): RequestHandler {
  const cached = proxyCache.get(service.id);
  if (cached) return cached;

  const target = new URL(service.upstreamUrl);
  const baseTarget = `${target.protocol}//${target.host}`;
  const pathSuffix = target.pathname;
  const isInternalTarget = internalHosts.has(target.host);

  // No on.error handler here — gateway.ts handles errors via the next() callback
  // to avoid sending a double response (proxy on.error + next() both firing).
  const proxy = createProxyMiddleware({
    target: baseTarget,
    changeOrigin: true,
    pathRewrite: () => pathSuffix,
    on: {
      proxyReq: (proxyReq: { setHeader: (name: string, value: string) => void }) => {
        if (isInternalTarget && config.PDF_INTERNAL_KEY) {
          proxyReq.setHeader('x-internal-key', config.PDF_INTERNAL_KEY);
        }
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
