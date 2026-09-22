// pdfjs-dist v4 legacy build — includes worker inline, no external worker needed
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assertSafeUrl } from '@lumora/net-guard';
import { logger } from './logger.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB

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

export async function fetchPdf(url: string): Promise<ArrayBuffer> {
  // Reject non-http(s) schemes and private/loopback/link-local targets before
  // ever touching the network.
  await assertSafeUrl(url, { allowedSchemes: ['http:', 'https:'] });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'Lumora-PDF-Service/0.1' },
      signal: controller.signal,
    });
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
