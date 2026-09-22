import { Keypair, StrKey } from '@stellar/stellar-sdk';

export const DEFAULT_ADMIN_API_KEY = 'change-me';
export const MIN_MAINNET_ADMIN_KEY_LENGTH = 24;

/**
 * Returns true when the admin API key is unsafe to run on mainnet:
 * still the documented default, or too short to resist guessing.
 */
export function isWeakAdminKey(key: string): boolean {
  return key === DEFAULT_ADMIN_API_KEY || key.length < MIN_MAINNET_ADMIN_KEY_LENGTH;
}

/**
 * Validates a Stellar Ed25519 public key (StrKey "G..." address).
 */
export function isValidStellarPublicKey(value: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(value);
  } catch {
    return false;
  }
}

/**
 * Validates that `secret` is a well-formed Stellar secret seed ("S...")
 * and that it derives exactly `publicKey`. Never throws and never
 * includes the secret value in any error.
 */
export function walletSecretMatchesPublicKey(secret: string, publicKey: string): boolean {
  if (!StrKey.isValidEd25519SecretSeed(secret)) return false;
  try {
    return Keypair.fromSecret(secret).publicKey() === publicKey;
  } catch {
    return false;
  }
}
