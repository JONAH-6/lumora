import { z } from 'zod';
import {
  isValidStellarPublicKey,
  isWeakAdminKey,
  MIN_MAINNET_ADMIN_KEY_LENGTH,
  walletSecretMatchesPublicKey,
} from './config-validation.js';

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_PATH: z.string().default('./lumora.db'),
  ROUTER_WALLET_PUBLIC: z.string().min(1),
  ROUTER_WALLET_SECRET: z.string().min(1),
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  STELLAR_HORIZON_URL: z.string().url(),
  STELLAR_RPC_URL: z.string().url(),
  USDC_ISSUER: z.string().min(1),
  ADMIN_API_KEY: z.string().min(1),
  PDF_INTERNAL_KEY: z.string().optional(),
  SPENDING_POLICY_CONTRACT_ID: z.string().optional(),
  PAYMENT_EXPIRY_SECONDS: z.coerce.number().default(300),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
