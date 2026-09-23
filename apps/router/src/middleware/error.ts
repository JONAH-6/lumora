import type { ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger.js';
import { InvalidAmountError } from '../stellar/utils.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof InvalidAmountError) {
    logger.warn({ err }, 'Rejected malformed amount');
    res.status(400).json({ error: err.message });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
};
