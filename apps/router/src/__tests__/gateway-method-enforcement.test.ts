import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express, type Router } from 'express';
import type { Server } from 'node:http';

process.env['DATABASE_PATH'] = ':memory:';
process.env['ROUTER_WALLET_PUBLIC'] = 'GROUTERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env['ROUTER_WALLET_SECRET'] = 'SROUTERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env['STELLAR_HORIZON_URL'] = 'https://horizon-testnet.stellar.org';
process.env['STELLAR_RPC_URL'] = 'https://soroban-testnet.stellar.org';
process.env['USDC_ISSUER'] = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
process.env['ADMIN_API_KEY'] = 'test-admin-key';

describe('gateway service.method enforcement', () => {
  let app: Express;
  let httpServer: Server;
  let baseUrl: string;
  const postServiceId = 'test-post-only-service';
  const getServiceId = 'test-get-only-service';

  beforeAll(async () => {
    const { insertService } = await import('../db/queries/services.js');
    insertService({
      id: postServiceId,
      name: 'Post Only Service',
      upstreamUrl: 'http://127.0.0.1:1/never-called',
      method: 'POST',
      priceUsdc: '0.0500000',
    });
    insertService({
      id: getServiceId,
      name: 'Get Only Service',
      upstreamUrl: 'http://127.0.0.1:1/never-called',
      method: 'GET',
      priceUsdc: '0.0100000',
    });

    // TypeScript's dynamic-import() typing does not resolve `.default` to the
    // module's declared type under this project's module settings; cast
    // explicitly instead of widening the module resolution config.
    const gatewayModule = await import('../routes/gateway.js');
    const gatewayRouter = gatewayModule.default as unknown as Router;

    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(gatewayRouter);
    httpServer = app.listen(0);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('failed to bind test server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('rejects a GET request to a POST-only service with 405 before issuing a 402', async () => {
    const res = await fetch(`${baseUrl}/services/${postServiceId}`, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('rejects a POST request to a GET-only service with 405 before issuing a 402', async () => {
    const res = await fetch(`${baseUrl}/services/${getServiceId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(405);
  });

  it('still issues a 402 challenge for a request matching the registered method', async () => {
    const res = await fetch(`${baseUrl}/services/${postServiceId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
  });
});
