import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['DATABASE_PATH'] = join(mkdtempSync(join(tmpdir(), 'lumora-challenges-')), 'test.db');
process.env['ROUTER_WALLET_PUBLIC'] = 'GROUTERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env['ROUTER_WALLET_SECRET'] = 'SROUTERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env['STELLAR_HORIZON_URL'] = 'https://horizon-testnet.stellar.org';
process.env['STELLAR_RPC_URL'] = 'https://soroban-testnet.stellar.org';
process.env['USDC_ISSUER'] = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
process.env['ADMIN_API_KEY'] = 'test-admin-key';

describe('challenges persistence and atomic consumption', () => {
  let insertChallenge: typeof import('../db/queries/challenges.js').insertChallenge;
  let getChallenge: typeof import('../db/queries/challenges.js').getChallenge;
  let consumeChallenge: typeof import('../db/queries/challenges.js').consumeChallenge;
  let deleteExpiredChallenges: typeof import('../db/queries/challenges.js').deleteExpiredChallenges;
  let closeDb: typeof import('../db/index.js').closeDb;
  let insertService: typeof import('../db/queries/services.js').insertService;
  const dbPath = process.env['DATABASE_PATH']!;

  beforeAll(async () => {
    const challenges = await import('../db/queries/challenges.js');
    insertChallenge = challenges.insertChallenge;
    getChallenge = challenges.getChallenge;
    consumeChallenge = challenges.consumeChallenge;
    deleteExpiredChallenges = challenges.deleteExpiredChallenges;

    const dbModule = await import('../db/index.js');
    closeDb = dbModule.closeDb;

    const servicesModule = await import('../db/queries/services.js');
    insertService = servicesModule.insertService;

    insertService({
      id: 'test-service',
      name: 'Test Service',
      upstreamUrl: 'http://127.0.0.1:1/never-called',
      method: 'POST',
      priceUsdc: '0.0500000',
    });
  });

  it('allows a single-use consumption of a pending challenge', () => {
    const now = Date.now();
    insertChallenge({
      requestId: 'req_single_use',
      serviceId: 'test-service',
      amount: '500000',
      expiresAt: now + 60_000,
    });

    expect(getChallenge('req_single_use')?.consumed).toBe(false);

    const first = consumeChallenge('req_single_use', now);
    expect(first).toBe(true);
    expect(getChallenge('req_single_use')?.consumed).toBe(true);

    const second = consumeChallenge('req_single_use', now);
    expect(second).toBe(false);
  });

  it('only allows one winner when two concurrent consumption attempts race', async () => {
    const now = Date.now();
    insertChallenge({
      requestId: 'req_concurrent',
      serviceId: 'test-service',
      amount: '500000',
      expiresAt: now + 60_000,
    });

    const [a, b] = await Promise.all([
      Promise.resolve(consumeChallenge('req_concurrent', now)),
      Promise.resolve(consumeChallenge('req_concurrent', now)),
    ]);

    const successes = [a, b].filter(Boolean);
    expect(successes).toHaveLength(1);
  });

  it('rejects consumption of an expired challenge', () => {
    const now = Date.now();
    insertChallenge({
      requestId: 'req_expired',
      serviceId: 'test-service',
      amount: '500000',
      expiresAt: now - 1000, // already expired
    });

    const result = consumeChallenge('req_expired', now);
    expect(result).toBe(false);
    expect(getChallenge('req_expired')?.consumed).toBe(false);
  });

  it('removes expired challenges via cleanup', () => {
    const now = Date.now();
    insertChallenge({
      requestId: 'req_cleanup',
      serviceId: 'test-service',
      amount: '500000',
      expiresAt: now - 1000,
    });

    const removed = deleteExpiredChallenges(now);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(getChallenge('req_cleanup')).toBeNull();
  });

  it('keeps a challenge consumable after a simulated process restart (fresh connection, same file)', async () => {
    const now = Date.now();
    insertChallenge({
      requestId: 'req_restart',
      serviceId: 'test-service',
      amount: '500000',
      expiresAt: now + 60_000,
    });

    // Simulate a process restart: close the current connection and reopen
    // a fresh one against the same database file on disk.
    closeDb();
    expect(process.env['DATABASE_PATH']).toBe(dbPath);

    const result = consumeChallenge('req_restart', Date.now());
    expect(result).toBe(true);
    expect(getChallenge('req_restart')?.consumed).toBe(true);
  });
});
