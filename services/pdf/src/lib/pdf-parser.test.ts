import { describe, expect, it, vi, afterEach } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

const { fetchPdf } = await import('./pdf-parser.js');

function makeResponse(options: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  contentLength?: string;
  body?: Uint8Array | null;
}): Response {
  const { ok = true, status = 200, contentType = 'application/pdf', contentLength, body = new Uint8Array([1, 2, 3]) } =
    options;

  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  if (contentLength) headers.set('content-length', contentLength);

  const stream =
    body === null
      ? null
      : new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        });

  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers,
    body: stream,
    arrayBuffer: async () => (body ? body.buffer : new ArrayBuffer(0)),
  } as unknown as Response;
}

describe('fetchPdf', () => {
  afterEach(() => {
    lookupMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('rejects a URL that resolves to a private address before fetching', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchPdf('https://internal.example.test/file.pdf')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) scheme before fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchPdf('file:///etc/passwd')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a response whose content-type is not a PDF', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ contentType: 'text/html' })),
    );

    await expect(fetchPdf('https://example.test/file.pdf')).rejects.toThrow(/content type/i);
  });

  it('rejects a response advertising a content-length over the size cap', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ contentLength: String(50 * 1024 * 1024) })),
    );

    await expect(fetchPdf('https://example.test/file.pdf')).rejects.toThrow(/too large/i);
  });

  it('rejects a streamed body that exceeds the size cap even without content-length', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const bigChunk = new Uint8Array(26 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: bigChunk })));

    await expect(fetchPdf('https://example.test/file.pdf')).rejects.toThrow(/exceeded maximum/i);
  });

  it('accepts a small, well-formed PDF response from a public address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const payload = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ body: payload })));

    const result = await fetchPdf('https://example.test/file.pdf');
    expect(new Uint8Array(result)).toEqual(payload);
  });
});
