import type { TokenLaunch } from '@kamby/db';
import type { LaunchEvmTx, LaunchProof } from '@kamby/domain';

/** A launch's public metadata (name, logo, links) as every launchpad reads it. */
export interface LaunchMetadata {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  metadataUri: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}

/** What a step hands back: the transaction to sign (base64) and what to store on the launch. */
export interface PreparedStep {
  /** Solana: the one transaction to sign (Kamby co-signs and sends it). */
  transactionBase64?: string;
  /** EVM: the transactions the creator sends from their wallet, in order. */
  evmTransactions?: LaunchEvmTx[];
  networkCostUsd?: number;
  fundUsdcRaw?: string;
  /** The coin's address, when the step already knows it (Solana: the new mint). */
  tokenAddress?: string;
}

/**
 * One launchpad (Pump.fun, Clanker, Four.meme…) — the modular piece of Kamby's LaunchPad. Every
 * launch is two creator signatures: `fund` (their USDC → the chain's coin, plus Kamby's fee) and
 * `create` (the coin itself, with the first buy). Each adapter builds exactly the transactions it
 * hands out; LaunchpadService checks that what comes back signed is that transaction.
 */
export interface LaunchAdapter {
  readonly id: 'pumpfun' | 'clanker' | 'fourmeme' | 'clanker-rh';
  readonly chainIdentifier: string;
  buildFunding(launch: TokenLaunch, feeUsd: number): Promise<PreparedStep>;
  /** Checks (and on Solana broadcasts) the funding step and waits for it; returns its signature or hash. */
  submitFunding(launch: TokenLaunch, proof: LaunchProof): Promise<string>;
  /** Anything the creator's browser needs before asking the launchpad itself (Four.meme: the first buy in BNB). */
  createParams?(launch: TokenLaunch): Promise<Record<string, string>>;
  /** `input`: what the creator's browser got from the launchpad, when it has to ask it directly (Four.meme). */
  buildCreate(launch: TokenLaunch, metadata: LaunchMetadata, input?: unknown): Promise<PreparedStep>;
  /** Broadcasts the signed create transaction and waits for it; returns its signature and what
   *  the first buy got (raw token units, null when there was none or it couldn't be read). */
  submitCreate(launch: TokenLaunch, proof: LaunchProof): Promise<{ signature: string; tokensRaw: string | null; tokenAddress?: string }>;
}
