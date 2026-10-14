import type { TokenLaunch } from '@kamby/db';

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
  transactionBase64: string;
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
  readonly id: 'pumpfun' | 'clanker' | 'fourmeme';
  readonly chainIdentifier: string;
  buildFunding(launch: TokenLaunch, feeUsd: number): Promise<PreparedStep>;
  /** Broadcasts the signed funding transaction and waits for it; returns its signature. */
  submitFunding(launch: TokenLaunch, signedTxBase64: string): Promise<string>;
  buildCreate(launch: TokenLaunch, metadata: LaunchMetadata): Promise<PreparedStep>;
  /** Broadcasts the signed create transaction and waits for it; returns its signature and what
   *  the first buy got (raw token units, null when there was none or it couldn't be read). */
  submitCreate(launch: TokenLaunch, signedTxBase64: string): Promise<{ signature: string; tokensRaw: string | null }>;
}
