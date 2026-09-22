import { Router, type Request, type Response } from 'express';
import { getService } from '../db/queries/services.js';
import { recordPayment } from '../db/queries/payments.js';
import { insertLog } from '../db/queries/logs.js';
import { buildChallenge } from '../x402/challenge.js';
import { verifyPaymentHeader } from '../x402/verify.js';
import { getServiceProxy } from '../lib/proxy.js';
import { notifySpend } from '../stellar/soroban.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Pending requests: requestId → { serviceId, expiresAt }
// Issued on 402; consumed on successful payment verification.
const pendingRequests = new Map<string, { serviceId: string; expiresAt: number }>();

// Evict expired pending requests every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, val] of pendingRequests) {
    if (now > val.expiresAt) pendingRequests.delete(id);
  }
}, 60_000).unref(); // .unref() so this timer doesn't prevent process exit

router.all('/services/:serviceId', async (req: Request, res: Response) => {
  const start = Date.now();
  const { serviceId } = req.params;
  const service = getService(serviceId as string);

  if (!service || !service.enabled) {
    res.status(404).json({ error: 'Service not found' });
    return;
  }

  if (req.method !== service.method) {
    res.status(405).json({ error: `Method ${req.method} not allowed for this service. Use ${service.method}.` });
    return;
  }

  const xPayment = req.headers['x-payment'] as string | undefined;

  // ── No payment header: issue 402 challenge ──────────────────────────────────
  if (!xPayment) {
    const resourceUrl = `${req.protocol}://${req.get('host')}${req.path}`;
    const challenge = buildChallenge(service, resourceUrl);
    const expiryMs = config.PAYMENT_EXPIRY_SECONDS * 1000;

    pendingRequests.set(challenge.requestId, {
      serviceId: service.id,
      expiresAt: Date.now() + expiryMs,
    });

    insertLog({ serviceId: service.id, status: '402', durationMs: Date.now() - start });
    res.status(402).json(challenge);
    return;
  }

  // ── Payment header present: extract requestId ───────────────────────────────
  // The client must include the X-Request-ID header with the requestId from the 402 challenge.
  const requestId = req.headers['x-request-id'] as string | undefined;

  if (!requestId) {
    res.status(400).json({ error: 'Missing X-Request-ID header (must match requestId from the 402 challenge)' });
    return;
  }

  // ── Validate that this requestId was issued by us ───────────────────────────
  // This prevents an attacker from submitting an arbitrary payment without first
  // receiving a 402 challenge from this router instance.
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    res.status(400).json({ error: 'Unknown or expired request ID. Make an unpaid request first to receive a 402 challenge.' });
    return;
  }

  if (pending.serviceId !== service.id) {
    res.status(400).json({ error: 'Request ID does not match service' });
    return;
  }

  if (Date.now() > pending.expiresAt) {
    pendingRequests.delete(requestId);
    res.status(402).json({ error: 'Request ID expired. Please retry to get a fresh 402 challenge.' });
    return;
  }

  // ── Verify payment ──────────────────────────────────────────────────────────
  const result = await verifyPaymentHeader(xPayment, requestId, service.id, service.priceUsdc);

  if (!result.ok) {
    logger.warn({ serviceId, requestId, error: result.error }, 'Payment verification failed');
    insertLog({ serviceId: service.id, status: 'error', durationMs: Date.now() - start });
    res.status(402).json({ error: result.error });
    return;
  }

  // ── Record payment (SQLite UNIQUE on tx_hash prevents double-spend) ─────────
  // Gracefully handle the race where two concurrent requests pass verification
  // before either records payment — the second INSERT will violate UNIQUE constraint.
  try {
    recordPayment({
      txHash: result.proof!.payload.txHash,
      serviceId: service.id,
      requestId,
      fromAddress: result.fromAddress!,
      amountRaw: result.proof!.payload.amount,
      asset: 'USDC',
    });
  } catch (err: unknown) {
    const isUniqueViolation =
      err instanceof Error && err.message.includes('UNIQUE constraint');
    if (isUniqueViolation) {
      res.status(402).json({ error: 'Payment already used' });
      return;
    }
    throw err;
  }

  // Consume the pending request
  pendingRequests.delete(requestId);

  logger.info(
    { serviceId, txHash: result.proof!.payload.txHash, from: result.fromAddress },
    'Payment verified, proxying',
  );

  // Fire-and-forget Soroban spend notification (non-blocking)
  void notifySpend(result.fromAddress!, result.proof!.payload.amount, service.id);

  // Remove payment headers before forwarding to upstream
  delete req.headers['x-payment'];
  delete req.headers['x-request-id'];

  insertLog({
    serviceId: service.id,
    txHash: result.proof!.payload.txHash,
    fromAddress: result.fromAddress,
    status: 'paid',
    durationMs: Date.now() - start,
  });

  // ── Proxy to upstream service ───────────────────────────────────────────────
  const proxy = getServiceProxy(service);
  proxy(req, res, (err: unknown) => {
    if (err) {
      logger.error({ err }, 'Proxy error after payment verification');
      if (!res.headersSent) {
        res.status(502).json({ error: 'Upstream service unavailable' });
      }
    }
  });
});

export default router;
