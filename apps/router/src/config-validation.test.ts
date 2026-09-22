import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  DEFAULT_ADMIN_API_KEY,
  MIN_MAINNET_ADMIN_KEY_LENGTH,
  isValidStellarPublicKey,
  isWeakAdminKey,
  walletSecretMatchesPublicKey,
} from './config-validation.js';

describe('isValidStellarPublicKey', () => {
  it('accepts a valid Ed25519 public key', () => {
    const keypair = Keypair.random();
    expect(isValidStellarPublicKey(keypair.publicKey())).toBe(true);
  });

  it('rejects an arbitrary string', () => {
    expect(isValidStellarPublicKey('not-a-stellar-key')).toBe(false);
  });

  it('rejects a secret seed used as a public key', () => {
    const keypair = Keypair.random();
    expect(isValidStellarPublicKey(keypair.secret())).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidStellarPublicKey('')).toBe(false);
  });
});

describe('walletSecretMatchesPublicKey', () => {
  it('accepts a secret that derives the given public key', () => {
    const keypair = Keypair.random();
    expect(walletSecretMatchesPublicKey(keypair.secret(), keypair.publicKey())).toBe(true);
  });

  it('rejects a secret paired with a mismatched public key', () => {
    const keypair = Keypair.random();
    const other = Keypair.random();
    expect(walletSecretMatchesPublicKey(keypair.secret(), other.publicKey())).toBe(false);
  });

  it('rejects a malformed secret seed', () => {
    const keypair = Keypair.random();
    expect(walletSecretMatchesPublicKey('not-a-secret-seed', keypair.publicKey())).toBe(false);
  });
});

describe('isWeakAdminKey', () => {
  it('flags the documented default key as weak', () => {
    expect(isWeakAdminKey(DEFAULT_ADMIN_API_KEY)).toBe(true);
  });

  it('flags a key shorter than the mainnet minimum as weak', () => {
    expect(isWeakAdminKey('a'.repeat(MIN_MAINNET_ADMIN_KEY_LENGTH - 1))).toBe(true);
  });

  it('accepts a key at least as long as the mainnet minimum', () => {
    expect(isWeakAdminKey('a'.repeat(MIN_MAINNET_ADMIN_KEY_LENGTH))).toBe(false);
  });
});
