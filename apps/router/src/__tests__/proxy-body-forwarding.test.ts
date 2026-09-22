import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express, type Router } from 'express';
import type { Server } from 'node:http';
import { startFakeUpstream, type FakeUpstream } from './helpers/fake-upstream.js';

// The router reads its config (and therefore opens its database) at module
// import time, so the test env must be set before anything under src/ is
// imported. Using dynamic imports below (after this block runs) guarantees
// that ordering regardless of ESM import hoisting.
process.env['DATABASE_PATH'] = ':memory:';
process.env['ROUTER_WALLET_PUBLIC'] = 'GROUTERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env['ROUTER_WALLET_SECRET'] = 'SROUTERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env['STELLAR_HORIZON_URL'] = 'https://horizon-testnet.stellar.org';
process.env['STELLAR_RPC_URL'] = 'https://soroban-testnet.stellar.org';
process.env['USDC_ISSUER'] = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
process.env['ADMIN_API_KEY'] = 'test-admin-key';

// Mock the Horizon verification call so the test never hits the real network.
// verify.ts imports `fetchAndVerifyPayment` from this module.
vi.mock('../stellar/horizon.js', () => ({
  fetchAndVerifyPayment: vi.fn(),
}));

describe('proxy body forwarding on paid POSTs', () => {
  let app: Express;
  let httpServer: Server;
  let baseUrl: string;
  let upstream: FakeUpstream;
  const serviceId = 'test-echo-service';

  beforeAll(async () => {
    upstream = await startFakeUpstream();

    const { insertService } = await import('../db/queries/services.js');
    insertService({
      id: serviceId,
      name: 'Test Echo Service',
      upstreamUrl: `${upstream.url}/echo`,
      method: 'POST',
      priceUsdc: '0.0500000',
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
    await upstream.close();
  });

  it('returns 402 for an unpaid request and issues a challenge', async () => {
    const res = await fetch(`${baseUrl}/services/${serviceId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(res.status).toBe(402);
    const challenge = (await res.json()) as { requestId: string };
    expect(typeof challenge.requestId).toBe('string');
    expect(upstream.received).toHaveLength(0);
  });

  it('forwards the exact JSON body to the upstream once payment is verified', async () => {
    // Step 1: unpaid request to obtain a requestId.
    const unpaidRes = await fetch(`${baseUrl}/services/${serviceId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 'bar', nested: { n: 1 } }),
    });
    expect(unpaidRes.status).toBe(402);
    const { requestId } = (await unpaidRes.json()) as { requestId: string };

    // Step 2: stub Horizon so the payment proof verifies successfully.
    const { fetchAndVerifyPayment } = await import('../stellar/horizon.js');
    vi.mocked(fetchAndVerifyPayment).mockResolvedValueOnce({
      txHash: 'a'.repeat(64),
      from: 'GAAAAABBBBBCCCCCDDDDDEEEEEFFFFFGGGGGHHHHHIIIIIJJJJJKKKKK',
      to: process.env['ROUTER_WALLET_PUBLIC']!,
      amount: '0.0500000',
      asset: 'USDC',
      issuer: process.env['USDC_ISSUER']!,
      memo: requestId,
      createdAt: new Date(),
    });

    const proof = {
      x402Version: 1,
      scheme: 'exact',
      network: 'stellar',
      payload: {
        txHash: 'a'.repeat(64),
        from: 'GAAAAABBBBBCCCCCDDDDDEEEEEFFFFFGGGGGHHHHHIIIIIJJJJJKKKKK',
        amount: '0.0500000',
      },
    };
    const xPayment = Buffer.from(JSON.stringify(proof)).toString('base64');
    const requestBody = { foo: 'bar', nested: { n: 1 } };

    const paidRes = await fetch(`${baseUrl}/services/${serviceId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-payment': xPayment,
        'x-request-id': requestId,
      },
      body: JSON.stringify(requestBody),
    });

    expect(paidRes.status).toBe(200);
    const proxied = (await paidRes.json()) as { echoedBody: string };
    expect(JSON.parse(proxied.echoedBody)).toEqual(requestBody);

    expect(upstream.received).toHaveLength(1);
    const received = upstream.received[0]!;
    expect(received.method).toBe('POST');
    expect(JSON.parse(received.body)).toEqual(requestBody);
    // Payment headers must not leak upstream.
    expect(received.headers['x-payment']).toBeUndefined();
    expect(received.headers['x-request-id']).toBeUndefined();
  });
});
