import type { X402PaymentProof } from './types.js';
import { fetchAndVerifyPayment, type PaymentVerificationFailureReason } from '../stellar/horizon.js';
import { isPaymentUsed } from '../db/queries/payments.js';
import { config } from '../config.js';
import { usdcToStroops } from '../stellar/utils.js';

export interface VerifyResult {
  ok: boolean;
  error?: string;
  proof?: X402PaymentProof;
  fromAddress?: string;
}

export async function verifyPaymentHeader(
  xPaymentHeader: string,
  expectedRequestId: string,
  _serviceId: string,
  priceUsdc: string,
): Promise<VerifyResult> {
  // 1. Decode base64 header
  let proof: X402PaymentProof;
  try {
    const decoded = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
    proof = JSON.parse(decoded) as X402PaymentProof;
  } catch {
    return { ok: false, error: 'Invalid X-PAYMENT header encoding' };
  }

  const { txHash, from, amount } = proof.payload;

  if (!txHash || !from || !amount) {
    return { ok: false, error: 'Malformed payment proof: missing txHash, from, or amount' };
  }

  // 2. Check anti-replay: tx hash not already used
  if (isPaymentUsed(txHash)) {
    return { ok: false, error: 'Payment already used' };
  }

  // 3. Fetch and verify transaction from Horizon: successful flag, memo type/value,
  //    and a matching `payment` operation (destination, asset, amount) in one pass.
  const requiredStroops = usdcToStroops(priceUsdc);
  const result = await fetchAndVerifyPayment(txHash, expectedRequestId, {
    destination: config.ROUTER_WALLET_PUBLIC,
    assetCode: 'USDC',
    assetIssuer: config.USDC_ISSUER,
    minAmountStroops: requiredStroops,
  });

  if (!result.ok) {
    return { ok: false, error: describeVerificationFailure(result.reason) };
  }

  const { payment } = result;

  // 4. Verify sender matches claim
  if (payment.from !== from) {
    return { ok: false, error: 'Payment sender mismatch' };
  }

  // 5. Verify transaction is not too old (anti-replay time window)
  const ageMs = Date.now() - payment.createdAt.getTime();
  const maxAgeMs = config.PAYMENT_EXPIRY_SECONDS * 1000;
  if (ageMs > maxAgeMs) {
    return { ok: false, error: 'Payment expired' };
  }

  return { ok: true, proof, fromAddress: from };
}

function describeVerificationFailure(reason: PaymentVerificationFailureReason): string {
  switch (reason) {
    case 'transaction_fetch_failed':
      return 'Transaction not found on network';
    case 'transaction_unsuccessful':
      return 'Transaction was not successful on the network';
    case 'invalid_memo_type':
      return 'Payment memo must be of type text';
    case 'memo_mismatch':
      return 'Payment memo does not match request ID';
    case 'no_matching_payment_operation':
      return 'No matching payment operation found for destination, asset and amount';
  }
}
