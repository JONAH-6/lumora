import { describe, expect, it, vi, afterEach } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

const { assertSafeUrl, isPrivateAddress, UnsafeUrlError } = await import('./index.js');

describe('isPrivateAddress', () => {
  it('allows public-looking IPv4 addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  it('allows public-looking IPv6 addresses', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('blocks loopback addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('127.53.1.2')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
  });

  it('blocks link-local addresses', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true); // cloud metadata endpoint
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });

  it('blocks RFC1918 private addresses', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
  });

  it('does not treat adjacent public ranges as private', () => {
    expect(isPrivateAddress('172.15.255.255')).toBe(false);
    expect(isPrivateAddress('172.32.0.0')).toBe(false);
  });

  it('blocks RFC4193 unique local IPv6 addresses', () => {
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fd12:3456:789a::1')).toBe(true);
  });

  it('blocks the unspecified address and IPv4-mapped private addresses', () => {
    expect(isPrivateAddress('::')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.5')).toBe(true);
  });

  it('treats a non-IP literal as unsafe', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('assertSafeUrl', () => {
  afterEach(() => {
    lookupMock.mockReset();
  });

  it('rejects disallowed schemes', async () => {
    await expect(assertSafeUrl('ftp://example.com/file')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects http when only https is allowed', async () => {
    await expect(assertSafeUrl('http://93.184.216.34/', { allowedSchemes: ['https:'] })).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects an invalid URL', async () => {
    await expect(assertSafeUrl('not a url')).rejects.toThrow(UnsafeUrlError);
  });

  it('allows a public https URL with a literal IP host', async () => {
    const result = await assertSafeUrl('https://93.184.216.34/report.pdf');
    expect(result.address).toBe('93.184.216.34');
  });

  it('rejects a URL whose literal IP host is private', async () => {
    await expect(assertSafeUrl('https://127.0.0.1/admin')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects a hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertSafeUrl('https://internal.example.test/')).rejects.toThrow(UnsafeUrlError);
  });

  it('allows a hostname that resolves to a public address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    const result = await assertSafeUrl('https://public.example.test/');
    expect(result.address).toBe('8.8.8.8');
  });
});
