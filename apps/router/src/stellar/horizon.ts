import { Horizon } from '@stellar/stellar-sdk';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { findMatchingPaymentOperation, type PaymentMatchCriteria } from './payment-matcher.js';

export type { PaymentMatchCriteria } from './payment-matcher.js';
export { findMatchingPaymentOperation } from './payment-matcher.js';

let _server: Horizon.Server | null = null;

export function getHorizon(): Horizon.Server {
  if (!_server) {
    _server = new Horizon.Server(config.STELLAR_HORIZON_URL);
  }
  return _server;
}

export interface VerifiedPayment {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  issuer: string | null;
  memo: string;
  createdAt: Date;
}

export type PaymentVerificationFailureReason =
  | 'transaction_fetch_failed'
  | 'transaction_unsuccessful'
  | 'invalid_memo_type'
  | 'memo_mismatch'
  | 'no_matching_payment_operation';

export type PaymentVerificationResult =
  | { ok: true; payment: VerifiedPayment }
  | { ok: false; reason: PaymentVerificationFailureReason };

export async function fetchAndVerifyPayment(
  txHash: string,
  expectedRequestId: string,
  criteria: PaymentMatchCriteria,
): Promise<PaymentVerificationResult> {
  const server = getHorizon();

  let tx: Horizon.ServerApi.TransactionRecord;
  try {
    tx = await server.transactions().transaction(txHash).call();
  } catch (err) {
    logger.error({ txHash, err }, 'Failed to fetch transaction from Horizon');
    return { ok: false, reason: 'transaction_fetch_failed' };
  }

  if (tx.successful !== true) {
    logger.warn({ txHash }, 'Transaction was not successful');
    return { ok: false, reason: 'transaction_unsuccessful' };
  }

  if (tx.memo_type !== 'text') {
    logger.warn({ txHash, memoType: tx.memo_type }, 'Transaction memo is not of type text');
    return { ok: false, reason: 'invalid_memo_type' };
  }

  if (tx.memo !== expectedRequestId) {
    logger.warn({ txHash, memo: tx.memo, expectedRequestId }, 'Memo mismatch');
    return { ok: false, reason: 'memo_mismatch' };
  }

  let ops: Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>;
  try {
    ops = await server.operations().forTransaction(txHash).call();
  } catch (err) {
    logger.error({ txHash, err }, 'Failed to fetch operations from Horizon');
    return { ok: false, reason: 'transaction_fetch_failed' };
  }

  const paymentOp = findMatchingPaymentOperation(ops.records, criteria);
  if (!paymentOp) {
    logger.warn({ txHash }, 'No matching payment operation found in transaction');
    return { ok: false, reason: 'no_matching_payment_operation' };
  }

  return {
    ok: true,
    payment: {
      txHash,
      from: paymentOp.from,
      to: paymentOp.to,
      amount: paymentOp.amount,
      asset: paymentOp.asset_type === 'native' ? 'XLM' : paymentOp.asset_code ?? 'UNKNOWN',
      issuer: paymentOp.asset_issuer ?? null,
      memo: tx.memo ?? '',
      createdAt: new Date(tx.created_at),
    },
  };
}
