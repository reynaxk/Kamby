import { z } from 'zod';

/**
 * Kamby's LaunchPad (2026-10-14) — create a coin from inside Kamby, paid in USDC like everything
 * else. Owner calls: Pump.fun (Solana), Clanker (Base) and Four.meme (BNB), in that order; Kamby's
 * fee is a fixed USDC amount (LAUNCH_FEE_USD on the API, default below); the creator's USDC is
 * swapped on the market for the chain's own coin the launch needs — Kamby holds no inventory.
 */
export const LAUNCHPADS = [
  { id: 'pumpfun', chainIdentifier: 'solana', chainName: 'Solana', name: 'Pump.fun', live: true },
  { id: 'clanker', chainIdentifier: 'eip155:8453', chainName: 'Base', name: 'Clanker', live: true },
  { id: 'fourmeme', chainIdentifier: 'eip155:56', chainName: 'BNB Chain', name: 'Four.meme', live: true },
  // Robinhood Chain (2026-10-15): Clanker deploys there too (its SDK has the factory); Kyber routes its pools.
  { id: 'clanker-rh', chainIdentifier: 'eip155:4663', chainName: 'Robinhood', name: 'Clanker', live: true },
] as const;
export type LaunchpadId = (typeof LAUNCHPADS)[number]['id'];

export const LAUNCH_LIMITS = {
  /** Kamby's launch fee in USDC (owner 2026-10-16: $5 → $3). LAUNCH_FEE_USD on the api overrides it. */
  defaultFeeUsd: 3,
  devBuyPresetsUsd: [10, 50, 100] as const,
  maxDevBuyUsd: 1_000,
  nameMax: 32,
  symbolMax: 10,
  descriptionMax: 500,
  imageMaxBytes: 1_000_000,
} as const;

const optionalUrl = z
  .string()
  .trim()
  .max(200)
  .url()
  .refine((u) => u.startsWith('https://'), 'Links must start with https://')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const LaunchInputSchema = z.object({
  launchpad: z.enum(['pumpfun', 'clanker', 'fourmeme', 'clanker-rh']),
  walletAddress: z.string().min(32).max(64),
  name: z.string().trim().min(1).max(LAUNCH_LIMITS.nameMax),
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(LAUNCH_LIMITS.symbolMax)
    .regex(/^[A-Za-z0-9]+$/, 'Ticker: letters and numbers only'),
  description: z.string().trim().max(LAUNCH_LIMITS.descriptionMax).optional(),
  imageId: z.string().uuid(),
  website: optionalUrl,
  twitter: optionalUrl,
  telegram: optionalUrl,
  devBuyUsd: z.number().min(0).max(LAUNCH_LIMITS.maxDevBuyUsd),
});
export type LaunchInput = z.infer<typeof LaunchInputSchema>;

export const LaunchStatusSchema = z.enum(['PREPARED', 'FUNDED', 'CREATING', 'LIVE', 'FAILED']);
export type LaunchStatus = z.infer<typeof LaunchStatusSchema>;

export const LaunchSchema = z.object({
  id: z.string(),
  launchpad: z.enum(['pumpfun', 'clanker', 'fourmeme', 'clanker-rh']),
  chainIdentifier: z.string(),
  name: z.string(),
  symbol: z.string(),
  imageUrl: z.string().nullable(),
  devBuyUsd: z.number(),
  feeUsd: z.number(),
  /** What the launch itself costs on-chain (accounts, network fees), in USD — an estimate. */
  networkCostUsd: z.number(),
  status: LaunchStatusSchema,
  tokenAddress: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
});
export type Launch = z.infer<typeof LaunchSchema>;

/** One EVM transaction the creator sends from their own wallet, in order. */
export const LaunchEvmTxSchema = z.object({
  chainId: z.number().int(),
  to: z.string(),
  data: z.string(),
  /** Wei, as a decimal string. */
  value: z.string(),
});
export type LaunchEvmTx = z.infer<typeof LaunchEvmTxSchema>;

/** A step the creator signs: on Solana one transaction (base64, Kamby co-signs and sends it);
 *  on EVM chains the transactions to send from their wallet, in order. */
export const LaunchStepSchema = z.object({
  launch: LaunchSchema,
  transactionBase64: z.string().optional(),
  evmTransactions: z.array(LaunchEvmTxSchema).optional(),
});
export type LaunchStep = z.infer<typeof LaunchStepSchema>;

/** What comes back for a step: the signed Solana transaction, or the EVM transaction hashes. */
export const LaunchProofSchema = z
  .object({
    signedTxBase64: z.string().max(20_000).optional(),
    txHashes: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).max(4).optional(),
  })
  .refine((p) => Boolean(p.signedTxBase64) !== Boolean(p.txHashes?.length), 'Send the signed transaction or the transaction hashes');
export type LaunchProof = z.infer<typeof LaunchProofSchema>;
