import { z } from 'zod';
import {
  isValidStellarPublicKey,
  isWeakAdminKey,
  MIN_MAINNET_ADMIN_KEY_LENGTH,
  walletSecretMatchesPublicKey,
} from './config-validation.js';

const schema = z
  .object({
    PORT: z.coerce.number().default(3001),
    DATABASE_PATH: z.string().default('./lumora.db'),
    ROUTER_WALLET_PUBLIC: z.string().min(1),
    ROUTER_WALLET_SECRET: z.string().min(1),
    STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    STELLAR_HORIZON_URL: z.string().url(),
    STELLAR_RPC_URL: z.string().url(),
    USDC_ISSUER: z.string().min(1),
    ADMIN_API_KEY: z.string().min(1),
    SPENDING_POLICY_CONTRACT_ID: z.string().optional(),
    PAYMENT_EXPIRY_SECONDS: z.coerce.number().default(300),
  })
  .superRefine((data, ctx) => {
    if (!isValidStellarPublicKey(data.ROUTER_WALLET_PUBLIC)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ROUTER_WALLET_PUBLIC'],
        message: 'ROUTER_WALLET_PUBLIC must be a valid Stellar Ed25519 public key',
      });
    }

    if (!isValidStellarPublicKey(data.USDC_ISSUER)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['USDC_ISSUER'],
        message: 'USDC_ISSUER must be a valid Stellar Ed25519 public key',
      });
    }

    if (!walletSecretMatchesPublicKey(data.ROUTER_WALLET_SECRET, data.ROUTER_WALLET_PUBLIC)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ROUTER_WALLET_SECRET'],
        message: 'ROUTER_WALLET_SECRET must be a valid Stellar secret key that derives ROUTER_WALLET_PUBLIC',
      });
    }

    if (data.STELLAR_NETWORK === 'mainnet' && isWeakAdminKey(data.ADMIN_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_API_KEY'],
        message: `ADMIN_API_KEY must not be the default value and must be at least ${MIN_MAINNET_ADMIN_KEY_LENGTH} characters on mainnet`,
      });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
