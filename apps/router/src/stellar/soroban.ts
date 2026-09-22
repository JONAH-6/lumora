import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Optional: call the Soroban spending policy contract.
 * This is fire-and-forget — failure does not block payment processing.
 */
export async function notifySpend(
  agentAddress: string,
  amountRaw: string,
  serviceId: string,
): Promise<void> {
  if (!config.SPENDING_POLICY_CONTRACT_ID) return;

  try {
    // Dynamic import to avoid loading Soroban SDK when not needed
    const { rpc, Contract, nativeToScVal, Address } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(config.STELLAR_RPC_URL);

    const contract = new Contract(config.SPENDING_POLICY_CONTRACT_ID);
    logger.debug({ agentAddress, amountRaw, serviceId }, 'Soroban spending policy notified (stub)');
    void server;
    void contract;
    void nativeToScVal;
    void Address;
  } catch (err) {
    logger.warn({ err }, 'Soroban spend notification failed (non-fatal)');
  }
}
