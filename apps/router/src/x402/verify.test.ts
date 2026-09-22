import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    ROUTER_WALLET_PUBLIC: 'GROUTERWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    USDC_ISSUER: 'GISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    PAYMENT_EXPIRY_SECONDS: 300,
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { isPaymentUsedMock } = vi.hoisted(() => ({
  isPaymentUsedMock: vi.fn(),
}));

vi.mock('../db/queries/payments.js', () => ({
  isPaymentUsed: isPaymentUsedMock,
}));

const { transactionCall, operationsCall } = vi.hoisted(() => ({
  transactionCall: vi.fn(),
  operationsCall: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', () => {
  class MockServer {
    transactions() {
      return { transaction: () => ({ call: transactionCall }) };
    }
    operations() {
      return { forTransaction: () => ({ call: operationsCall }) };
    }
  }
  return { Horizon: { Server: MockServer } };
});

const { verifyPaymentHeader } = await import('./verify.js');

const DESTINATION = 'GROUTERWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const ISSUER = 'GISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const SENDER = 'GSENDERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const REQUEST_ID = 'req-abc-123';
const TX_HASH = 'a'.repeat(64);
const PRICE_USDC = '1.0000000';

function proofHeader(overrides: Record<string, unknown> = {}) {
  const proof = {
    x402Version: 1,
    scheme: 'exact',
    network: 'stellar',
    payload: {
      txHash: TX_HASH,
      from: SENDER,
      amount: PRICE_USDC,
      ...overrides,
    },
  };
  return Buffer.from(JSON.stringify(proof), 'utf-8').toString('base64');
}

function baseTx(overrides: Record<string, unknown> = {}) {
  return {
    successful: true,
    memo_type: 'text',
    memo: REQUEST_ID,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function matchingOp(overrides: Record<string, unknown> = {}) {
  return {
    type: 'payment',
    from: SENDER,
    to: DESTINATION,
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: ISSUER,
    amount: '1.0000000',
    ...overrides,
  };
}

beforeEach(() => {
  transactionCall.mockReset();
  operationsCall.mockReset();
  isPaymentUsedMock.mockReset();
  isPaymentUsedMock.mockReturnValue(false);
});

describe('verifyPaymentHeader', () => {
  it('accepts a valid payment end to end', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(true);
    expect(result.fromAddress).toBe(SENDER);
    expect(result.proof?.payload.txHash).toBe(TX_HASH);
  });

  it('rejects a header that is not valid base64/JSON', async () => {
    const result = await verifyPaymentHeader('%%%not-base64%%%', REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid X-PAYMENT header encoding');
    expect(transactionCall).not.toHaveBeenCalled();
  });

  it('rejects a header that decodes to malformed JSON', async () => {
    const malformed = Buffer.from('{not valid json', 'utf-8').toString('base64');

    const result = await verifyPaymentHeader(malformed, REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid X-PAYMENT header encoding');
    expect(transactionCall).not.toHaveBeenCalled();
  });

  it('rejects when the payload is missing required fields', async () => {
    const proof = {
      x402Version: 1,
      scheme: 'exact',
      network: 'stellar',
      payload: { txHash: TX_HASH, from: '', amount: '' },
    };
    const header = Buffer.from(JSON.stringify(proof), 'utf-8').toString('base64');

    const result = await verifyPaymentHeader(header, REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Malformed payment proof: missing txHash, from, or amount');
    expect(transactionCall).not.toHaveBeenCalled();
  });

  it('behaves safely when no request id is supplied (missing X-Request-ID upstream)', async () => {
    // Gateway route rejects a missing X-Request-ID before calling verifyPaymentHeader,
    // but verifyPaymentHeader itself must still fail closed rather than crash if ever
    // invoked with an empty expected request id.
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await verifyPaymentHeader(proofHeader(), '', 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Payment memo does not match request ID');
  });

  it('rejects a replayed txHash before contacting Horizon', async () => {
    isPaymentUsedMock.mockReturnValue(true);

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Payment already used');
    expect(transactionCall).not.toHaveBeenCalled();
  });

  it('rejects a failed transaction', async () => {
    transactionCall.mockResolvedValue(baseTx({ successful: false }));
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Transaction was not successful on the network');
  });

  it('rejects a wrong memo', async () => {
    transactionCall.mockResolvedValue(baseTx({ memo: 'some-other-request-id' }));
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Payment memo does not match request ID');
  });

  it('rejects a wrong destination', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({
      records: [matchingOp({ to: 'GWRONGDESTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })],
    });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No matching payment operation found for destination, asset and amount');
  });

  it('rejects a wrong asset code', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({ records: [matchingOp({ asset_code: 'EURC' })] });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No matching payment operation found for destination, asset and amount');
  });

  it('rejects a wrong asset issuer', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({
      records: [matchingOp({ asset_issuer: 'GOTHERISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })],
    });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No matching payment operation found for destination, asset and amount');
  });

  it('rejects an underpayment', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({ records: [matchingOp({ amount: '0.9999999' })] });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No matching payment operation found for destination, asset and amount');
  });

  it('accepts an overpayment', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({ records: [matchingOp({ amount: '5.0000000' })] });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(true);
  });

  it('rejects a mismatched sender claim', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await verifyPaymentHeader(
      proofHeader({ from: 'GNOTTHESENDERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }),
      REQUEST_ID,
      'svc-1',
      PRICE_USDC,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Payment sender mismatch');
  });

  it('rejects an expired payment window', async () => {
    const oldDate = new Date(Date.now() - 301_000).toISOString();
    transactionCall.mockResolvedValue(baseTx({ created_at: oldDate }));
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await verifyPaymentHeader(proofHeader(), REQUEST_ID, 'svc-1', PRICE_USDC);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Payment expired');
  });
});
