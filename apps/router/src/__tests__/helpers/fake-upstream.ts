import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

export interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface FakeUpstream {
  server: Server;
  url: string;
  /** Requests the fake upstream has received so far, in order. */
  received: ReceivedRequest[];
  close: () => Promise<void>;
}

/**
 * A minimal HTTP server that records every request it receives (method,
 * headers, raw body) and echoes the body back as `{ echoedBody: <raw body> }`.
 * Used to prove the router forwards the original request body/headers
 * unchanged when proxying a paid request upstream.
 */
export function startFakeUpstream(): Promise<FakeUpstream> {
  const received: ReceivedRequest[] = [];

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echoedBody: body }));
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine fake upstream address'));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        received,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
