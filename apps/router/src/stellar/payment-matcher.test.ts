import { describe, expect, it } from 'vitest';
import type { Horizon } from '@stellar/stellar-sdk';
import { findMatchingPaymentOperation, type PaymentMatchCriteria } from './payment-matcher.js';

const DESTINATION = 'GROUTERWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const ISSUER = 'GISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const SENDER = 'GSENDERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

function paymentOp(overrides: Partial<Horizon.ServerApi.PaymentOperationRecord> = {}) {
  return {
    type: 'payment',
    from: SENDER,
    to: DESTINATION,
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: ISSUER,
    amount: '1.0000000',
    ...overrides,
  } as unknown as Horizon.ServerApi.PaymentOperationRecord;
}

function pathPaymentOp(overrides: Record<string, unknown> = {}) {
  return {
    type: 'path_payment_strict_send',
    from: SENDER,
    to: DESTINATION,
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: ISSUER,
    amount: '1.0000000',
    ...overrides,
  } as unknown as Horizon.ServerApi.OperationRecord;
}

const criteria: PaymentMatchCriteria = {
  destination: DESTINATION,
  assetCode: 'USDC',
  assetIssuer: ISSUER,
  minAmountStroops: 10_000_000n, // 1.0000000 USDC
};

describe('findMatchingPaymentOperation', () => {
  it('accepts a successful transaction with a single matching payment op', () => {
    const match = findMatchingPaymentOperation([paymentOp()], criteria);
    expect(match).not.toBeNull();
    expect(match?.from).toBe(SENDER);
  });

  it('rejects when destination does not match', () => {
    const match = findMatchingPaymentOperation(
      [paymentOp({ to: 'GWRONGDESTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })],
      criteria,
    );
    expect(match).toBeNull();
  });

  it('rejects when asset code does not match', () => {
    const match = findMatchingPaymentOperation([paymentOp({ asset_code: 'EURC' })], criteria);
    expect(match).toBeNull();
  });

  it('rejects when asset issuer does not match', () => {
    const match = findMatchingPaymentOperation(
      [paymentOp({ asset_issuer: 'GOTHERISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })],
      criteria,
    );
    expect(match).toBeNull();
  });

  it('rejects when amount is under the required minimum', () => {
    const match = findMatchingPaymentOperation([paymentOp({ amount: '0.9999999' })], criteria);
    expect(match).toBeNull();
  });

  it('accepts when amount is over the required minimum (overpayment)', () => {
    const match = findMatchingPaymentOperation([paymentOp({ amount: '5.0000000' })], criteria);
    expect(match).not.toBeNull();
  });

  it('ignores path_payment_strict_send/receive ops rather than matching them', () => {
    const match = findMatchingPaymentOperation(
      [pathPaymentOp(), pathPaymentOp({ type: 'path_payment_strict_receive' })],
      criteria,
    );
    expect(match).toBeNull();
  });

  it('finds a matching op later in a multi-operation transaction', () => {
    const nonMatching = paymentOp({ asset_code: 'EURC' });
    const matching = paymentOp({ amount: '2.5000000' });
    const match = findMatchingPaymentOperation([pathPaymentOp(), nonMatching, matching], criteria);
    expect(match).not.toBeNull();
    expect(match?.amount).toBe('2.5000000');
  });

  it('returns null when no operation matches at all', () => {
    const match = findMatchingPaymentOperation([], criteria);
    expect(match).toBeNull();
  });

  it('matches native XLM payments when criteria expects XLM with no issuer', () => {
    const nativeCriteria: PaymentMatchCriteria = {
      destination: DESTINATION,
      assetCode: 'XLM',
      assetIssuer: null,
      minAmountStroops: 10_000_000n,
    };
    const match = findMatchingPaymentOperation(
      [paymentOp({ asset_type: 'native', asset_code: undefined, asset_issuer: undefined, amount: '1.0000000' })],
      nativeCriteria,
    );
    expect(match).not.toBeNull();
  });
});
