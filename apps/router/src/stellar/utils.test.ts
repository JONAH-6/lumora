import { describe, it, expect } from 'vitest';
import { usdcToStroops, stroopsToUsdc, isValidStellarAddress } from './utils.js';

describe('usdcToStroops', () => {
  it('converts a whole-number amount', () => {
    expect(usdcToStroops('5')).toBe(50_000_000n);
  });

  it('converts a 7-decimal USDC amount with no rounding', () => {
    expect(usdcToStroops('0.0500000')).toBe(500_000n);
  });

  it('converts a value with fewer than 7 decimal places', () => {
    expect(usdcToStroops('1.5')).toBe(15_000_000n);
  });

  it('converts a large amount exactly', () => {
    expect(usdcToStroops('12345.6789012')).toBe(123_456_789_012n);
  });

  it('rejects an empty string', () => {
    expect(() => usdcToStroops('')).toThrow();
  });

  it('rejects a whitespace-only string', () => {
    expect(() => usdcToStroops('   ')).toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() => usdcToStroops('-1.5')).toThrow();
  });

  it('rejects a non-numeric string', () => {
    expect(() => usdcToStroops('abc')).toThrow();
  });

  it('rejects a string with too many decimal places', () => {
    expect(() => usdcToStroops('1.12345678')).toThrow();
  });

  it('rejects scientific notation', () => {
    expect(() => usdcToStroops('1e5')).toThrow();
  });

  it('rejects a string with multiple decimal points', () => {
    expect(() => usdcToStroops('1.2.3')).toThrow();
  });

  it('rejects a string with embedded whitespace', () => {
    expect(() => usdcToStroops('1 000')).toThrow();
  });
});

describe('stroopsToUsdc', () => {
  it('converts a whole-number stroop amount', () => {
    expect(stroopsToUsdc(50_000_000n)).toBe('5.0000000');
  });

  it('converts a fractional stroop amount', () => {
    expect(stroopsToUsdc(500_000n)).toBe('0.0500000');
  });

  it('handles negative stroop amounts', () => {
    expect(stroopsToUsdc(-500_000n)).toBe('-0.0500000');
  });
});

describe('round-trip conversion', () => {
  const cleanValues = ['5', '0.0500000', '1.5000000', '12345.6789012', '0.0000001', '0'];

  for (const value of cleanValues) {
    it(`round-trips ${value}`, () => {
      const normalized = value.includes('.') ? value : `${value}.0000000`;
      expect(stroopsToUsdc(usdcToStroops(value))).toBe(normalized);
    });
  }
});

describe('isValidStellarAddress', () => {
  it('accepts a valid Stellar Ed25519 public key', () => {
    expect(
      isValidStellarAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'),
    ).toBe(true);
  });

  it('rejects a malformed address', () => {
    expect(isValidStellarAddress('not-a-valid-address')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });
});
