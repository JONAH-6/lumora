// pdfjs-dist v4 legacy build — includes worker inline, no external worker needed
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { assertSafeUrl } from '@lumora/net-guard';
import { logger } from './logger.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Disable web worker for Node.js server-side use.
// Setting workerSrc to a non-URL string prevents worker spawn attempts.
// The legacy build falls back to synchronous rendering when no worker is available.
(pdfjsLib.GlobalWorkerOptions as { workerSrc: string }).workerSrc = 'suppress';

export interface ExtractTextResult {
  text: string;
  pageCount: number;
  wordCount: number;
}

export interface PageResult {
  num: number;
  text: string;
  wordCount: number;
}

export interface ToJsonResult {
  pages: PageResult[];
  pageCount: number;
  wordCount: number;
}

/**
 * Fetches `rawUrl`, re-validating and re-resolving on every redirect hop
 * (a redirect to a private/loopback address is rejected just like the
 * original URL would be), and pins each request's TCP connection to the
 * exact address that was validated. Pinning closes the DNS-rebinding
 * window where a hostname could resolve to a public address during the
 * check and to a private one when the socket actually connects.
 */
async function fetchValidated(rawUrl: string, signal: AbortSignal, redirectsLeft: number): Promise<Response> {
  const { url, address } = await assertSafeUrl(rawUrl, { allowedSchemes: ['http:', 'https:'] });
  const family = isIP(address);
  if (family !== 4 && family !== 6) {
    throw new Error(`Resolved address is not a valid IP literal: ${address}`);
  }

  const dispatcher = new Agent({
    connect: {
      // Pin to the already-validated address instead of letting undici
      // perform its own DNS lookup at connect time.
      lookup: (_hostname, _options, callback) => callback(null, address, family),
    },
  });

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'Lumora-PDF-Service/0.1' },
      signal,
      redirect: 'manual',
      // Node's global `fetch` types its `dispatcher` option against the
      // ambient `undici-types` package, which is structurally close to
      // but not identical to the standalone `undici` package's own
      // `Agent` type (they version independently). This is a type-only
      // mismatch between two declarations of the same shape; at runtime
      // Node's fetch accepts any undici-compatible dispatcher.
      dispatcher: dispatcher as unknown as NonNullable<Parameters<typeof fetch>[1]>['dispatcher'],
    });
  } finally {
    await dispatcher.close();
  }

  if (REDIRECT_STATUSES.has(response.status)) {
    if (redirectsLeft <= 0) {
      throw new Error('Too many redirects while fetching PDF');
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Redirect response (${response.status}) is missing a Location header`);
    }
    const nextUrl = new URL(location, url).toString();
    return fetchValidated(nextUrl, signal, redirectsLeft - 1);
  }

  return response;
}

export async function fetchPdf(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    // Every hop (including the first) is validated and address-pinned
    // inside fetchValidated, so a redirect can never reach a target that
    // would have been rejected if requested directly.
    response = await fetchValidated(url, controller.signal, MAX_REDIRECTS);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timed out fetching PDF after ${FETCH_TIMEOUT_MS}ms`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/pdf')) {
    throw new Error(`Unexpected content type for PDF: ${contentType || 'unknown'}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new Error(`PDF response too large: ${contentLength} bytes`);
  }

  if (!response.body) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`PDF response exceeded maximum allowed size of ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }

  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data.buffer;
}

async function loadDocument(input: { url?: string; base64?: string }) {
  let data: ArrayBuffer;

  if (input.url) {
    logger.debug({ url: input.url }, 'Fetching PDF from URL');
    data = await fetchPdf(input.url);
  } else if (input.base64) {
    // Correctly extract a standalone ArrayBuffer from a Node.js Buffer
    // (Buffer.buffer may be a shared pool — must slice to get correct view)
    const buf = Buffer.from(input.base64, 'base64');
    data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } else {
    throw new Error('Either url or base64 must be provided');
  }

  return pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableRange: false,
  }).promise;
}

export async function extractText(input: { url?: string; base64?: string }): Promise<ExtractTextResult> {
  const doc = await loadDocument(input);
  const pageCount = doc.numPages;
  const textParts: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    textParts.push(pageText);
    page.cleanup();
  }

  const text = textParts.join('\n\n');
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return { text, pageCount, wordCount };
}

export async function toJson(input: { url?: string; base64?: string }): Promise<ToJsonResult> {
  const doc = await loadDocument(input);
  const pageCount = doc.numPages;
  const pages: PageResult[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    pages.push({ num: i, text, wordCount });
    page.cleanup();
  }

  const wordCount = pages.reduce((sum, p) => sum + p.wordCount, 0);
  return { pages, pageCount, wordCount };
}
