import type { Horizon } from '@stellar/stellar-sdk';
import { usdcToStroops } from './utils.js';

/**
 * Criteria a `payment` operation must satisfy to be accepted as proof of payment.
 * Amount comparisons are done in stroops (BigInt) to avoid float precision loss;
 * `minAmountStroops` is a lower bound, so overpayment is accepted.
 */
export interface PaymentMatchCriteria {
  destination: string;
  assetCode: string;
  assetIssuer: string | null;
  minAmountStroops: bigint;
}

/**
 * Pure, network-free matcher: finds the first `payment` operation whose destination,
 * asset code, asset issuer and amount satisfy the given criteria.
 *
 * `path_payment_strict_send` / `path_payment_strict_receive` operations are explicitly
 * skipped even though they can share fields with a `payment` op (e.g. `to`/`asset_code`
 * on the receive side) — only an exact `payment` operation type is eligible.
 */
export function findMatchingPaymentOperation(
  operations: readonly Horizon.ServerApi.OperationRecord[],
  criteria: PaymentMatchCriteria,
): Horizon.ServerApi.PaymentOperationRecord | null {
  for (const op of operations) {
    if (op.type !== 'payment') {
      // Explicitly ignore path_payment_strict_send / path_payment_strict_receive
      // (and every other operation type) rather than silently matching them.
      continue;
    }

    const paymentOp = op as Horizon.ServerApi.PaymentOperationRecord;
    const opAssetCode = paymentOp.asset_type === 'native' ? 'XLM' : paymentOp.asset_code ?? 'UNKNOWN';
    const opAssetIssuer = paymentOp.asset_issuer ?? null;

    if (paymentOp.to !== criteria.destination) continue;
    if (opAssetCode !== criteria.assetCode) continue;
    if (opAssetIssuer !== criteria.assetIssuer) continue;

    const opAmountStroops = usdcToStroops(paymentOp.amount);
    if (opAmountStroops < criteria.minAmountStroops) continue;

    return paymentOp;
  }

  return null;
}
