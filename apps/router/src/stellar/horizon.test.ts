import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PaymentMatchCriteria } from './payment-matcher.js';
import { fetchAndVerifyPayment } from './horizon.js';

vi.mock('../config.js', () => ({
  config: {
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
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

const DESTINATION = 'GROUTERWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const ISSUER = 'GISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const SENDER = 'GSENDERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const REQUEST_ID = 'req-abc-123';

const criteria: PaymentMatchCriteria = {
  destination: DESTINATION,
  assetCode: 'USDC',
  assetIssuer: ISSUER,
  minAmountStroops: 10_000_000n,
};

function baseTx(overrides: Record<string, unknown> = {}) {
  return {
    successful: true,
    memo_type: 'text',
    memo: REQUEST_ID,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function matchingOp() {
  return {
    type: 'payment',
    from: SENDER,
    to: DESTINATION,
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: ISSUER,
    amount: '1.0000000',
  };
}

beforeEach(() => {
  transactionCall.mockReset();
  operationsCall.mockReset();
});

describe('fetchAndVerifyPayment', () => {
  it('accepts a successful transaction with a matching payment operation', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await fetchAndVerifyPayment('txhash1', REQUEST_ID, criteria);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payment.from).toBe(SENDER);
    }
  });

  it('rejects a transaction where successful is not true', async () => {
    transactionCall.mockResolvedValue(baseTx({ successful: false }));
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await fetchAndVerifyPayment('txhash2', REQUEST_ID, criteria);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('transaction_unsuccessful');
    }
  });

  it('rejects when the memo does not match the expected request id', async () => {
    transactionCall.mockResolvedValue(baseTx({ memo: 'some-other-memo' }));
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await fetchAndVerifyPayment('txhash3', REQUEST_ID, criteria);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('memo_mismatch');
    }
  });

  it('rejects when memo_type is not text', async () => {
    transactionCall.mockResolvedValue(baseTx({ memo_type: 'hash' }));
    operationsCall.mockResolvedValue({ records: [matchingOp()] });

    const result = await fetchAndVerifyPayment('txhash4', REQUEST_ID, criteria);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_memo_type');
    }
  });

  it('rejects when no operation matches the payment criteria', async () => {
    transactionCall.mockResolvedValue(baseTx());
    operationsCall.mockResolvedValue({
      records: [{ ...matchingOp(), to: 'GWRONGDESTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }],
    });

    const result = await fetchAndVerifyPayment('txhash5', REQUEST_ID, criteria);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_matching_payment_operation');
    }
  });
});
