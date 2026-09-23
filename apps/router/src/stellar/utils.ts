import { StrKey } from '@stellar/stellar-sdk';

/**
 * Raised when a USDC amount string is not well-formed. Distinct from a
 * generic Error so the error middleware can map it to a 4xx response
 * instead of the default 500.
 */
export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

// Non-negative decimal amount with at most 7 fractional digits (USDC precision).
// No leading/trailing whitespace, no exponents, no sign.
const USDC_AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;

/**
 * Convert a USDC decimal string (e.g. "0.0500000") to stroops (bigint).
 * Uses string arithmetic to avoid floating-point precision loss.
 */
export function usdcToStroops(usdc: string): bigint {
  if (!usdc || usdc.trim() === '') {
    throw new InvalidAmountError('Empty amount string');
  }
  const trimmed = usdc.trim();
  if (!USDC_AMOUNT_PATTERN.test(trimmed)) {
    throw new InvalidAmountError(`Malformed USDC amount: ${usdc}`);
  }
  const [whole, decimals = ''] = trimmed.split('.');
  const paddedDecimals = decimals.padEnd(7, '0');
  return BigInt(whole) * 10_000_000n + BigInt(paddedDecimals);
}

/**
 * Convert stroops (bigint) to USDC decimal string with 7 decimal places.
 */
export function stroopsToUsdc(stroops: bigint | number | string): string {
  const n = BigInt(stroops);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 10_000_000n;
  const remainder = abs % 10_000_000n;
  const result = `${whole}.${remainder.toString().padStart(7, '0')}`;
  return negative ? `-${result}` : result;
}

/**
 * Convert stroops bigint to a Stellar-formatted decimal string (7 places).
 * Used when submitting transactions via the Stellar SDK.
 */
export function stroopsToStellarAmount(stroops: string | bigint): string {
  return stroopsToUsdc(stroops);
}

export function isValidStellarAddress(address: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}
