import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Thrown when a URL's scheme or resolved address is not allowed to be
 * fetched from server-side code (SSRF protection).
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface SafeUrlOptions {
  /** URL schemes that are allowed. Defaults to ['https:']. */
  allowedSchemes?: string[];
}

export interface SafeUrlResult {
  url: URL;
  /** The resolved IP address that was validated (and should be connected to). */
  address: string;
}

/**
 * Parses `rawUrl`, rejects disallowed schemes, resolves the hostname via
 * DNS (a literal IP is used as-is), and rejects loopback, link-local and
 * private (RFC1918 / RFC4193, etc.) addresses. Resolution happens once so
 * the caller can reuse the resolved address instead of re-resolving DNS
 * later (avoids a DNS-rebinding window between the check and the fetch).
 *
 * Throws `UnsafeUrlError` if the URL is invalid or unsafe to fetch.
 */
export async function assertSafeUrl(rawUrl: string, options: SafeUrlOptions = {}): Promise<SafeUrlResult> {
  const allowedSchemes = options.allowedSchemes ?? ['https:'];

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (!allowedSchemes.includes(url.protocol)) {
    throw new UnsafeUrlError(`URL scheme "${url.protocol}" is not allowed`);
  }

  const hostname = url.hostname;
  if (!hostname) {
    throw new UnsafeUrlError('URL has no hostname');
  }

  const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map((r) => r.address);

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Could not resolve host: ${hostname}`);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new UnsafeUrlError(`URL "${rawUrl}" resolves to a disallowed address: ${address}`);
    }
  }

  return { url, address: addresses[0]! };
}

/**
 * Returns true if `address` is a loopback, link-local, or private
 * (RFC1918 for IPv4, RFC4193/link-local for IPv6, and related reserved
 * ranges) IP address, or is not a valid IP literal at all.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIPv4(address);
  }
  if (family === 6) {
    return isPrivateIPv6(address);
  }
  // Not a valid IP literal — never safe to treat as a connect target.
  return true;
}

function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = octets as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255 broadcast

  return false;
}

/** Expands an IPv6 address (including embedded IPv4 and "::" compression) into 8 16-bit groups. */
function expandIPv6(address: string): number[] {
  const withoutZone = address.split('%')[0]!;
  const [head = '', tail = withoutZone.includes('::') ? '' : undefined] = withoutZone.split('::');

  const expandDotted = (parts: string[]): string[] => {
    const last = parts[parts.length - 1];
    if (last && last.includes('.')) {
      const ipv4 = last.split('.').map(Number);
      if (ipv4.length !== 4 || ipv4.some((n) => Number.isNaN(n))) return parts;
      const hi = (((ipv4[0]! << 8) | ipv4[1]!) >>> 0).toString(16);
      const lo = (((ipv4[2]! << 8) | ipv4[3]!) >>> 0).toString(16);
      return [...parts.slice(0, -1), hi, lo];
    }
    return parts;
  };

  const headParts = expandDotted(head ? head.split(':') : []);
  const tailParts = tail === undefined ? [] : expandDotted(tail ? tail.split(':') : []);
  const missing = 8 - (headParts.length + tailParts.length);
  const groups = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];

  return groups.slice(0, 8).map((g) => parseInt(g || '0', 16));
}

function isPrivateIPv6(address: string): boolean {
  const groups = expandIPv6(address);
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return true;

  const isZero = groups.every((g) => g === 0);
  if (isZero) return true; // :: unspecified

  const isLoopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
  if (isLoopback) return true; // ::1

  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4 address.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const a = (groups[6]! >> 8) & 0xff;
    const b = groups[6]! & 0xff;
    const c = (groups[7]! >> 8) & 0xff;
    const d = groups[7]! & 0xff;
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
  }

  const first = groups[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (RFC4193)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}
