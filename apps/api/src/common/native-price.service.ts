import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/** Wrapped-native tokens whose DexScreener price stands in for the chain's own coin. */
const WRAPPED: Record<'ETH' | 'BNB', { chain: string; address: string }> = {
  ETH: { chain: 'base', address: '0x4200000000000000000000000000000000000006' },
  BNB: { chain: 'bsc', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
};
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const TTL_MS = 30_000;

export type NativeSymbol = 'SOL' | 'ETH' | 'BNB';

/** Each trading chain's own coin (2026-11-01: trades pay with it, not USDC). */
export const NATIVE_SYMBOL_BY_CHAIN_ID: Readonly<Record<number, 'ETH' | 'BNB'>> = { 8453: 'ETH', 56: 'BNB', 4663: 'ETH' };

/**
 * USD prices of SOL, ETH and BNB (2026-11-01, native-coin trading) — to size trades for the fee
 * tier and the $2 minimum, and to value a trade's dollar side for P&L. ETH and BNB from
 * DexScreener (their wrapped tokens' deepest pools), SOL from Jupiter; cached 30s, and the last
 * good price is kept when a refresh fails. `null` only when no price was ever read.
 */
@Injectable()
export class NativePriceService {
  private readonly cache = new Map<NativeSymbol, { usd: number; at: number }>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('NativePriceService');
  }

  async usd(symbol: NativeSymbol): Promise<number | null> {
    const hit = this.cache.get(symbol);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.usd;
    try {
      const usd = symbol === 'SOL' ? await this.solana() : await this.evm(symbol);
      if (usd && usd > 0) {
        this.cache.set(symbol, { usd, at: Date.now() });
        return usd;
      }
    } catch (error) {
      this.logger.warn({ err: error, symbol }, 'Native price read failed — using the last one');
    }
    return hit?.usd ?? null;
  }

  async usdForChain(chainId: number): Promise<number | null> {
    const symbol = NATIVE_SYMBOL_BY_CHAIN_ID[chainId];
    return symbol ? this.usd(symbol) : null;
  }

  private async evm(symbol: 'ETH' | 'BNB'): Promise<number | null> {
    const { chain, address } = WRAPPED[symbol];
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${address}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const pairs = (await res.json()) as { baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }[];
    // The deepest pool where the wrapped coin is the base token.
    const best = (Array.isArray(pairs) ? pairs : [])
      .filter((p) => p.baseToken?.address?.toLowerCase() === address.toLowerCase() && Number(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return best ? Number(best.priceUsd) : null;
  }

  private async solana(): Promise<number | null> {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL_MINT}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, { usdPrice?: number }>;
    return body[WSOL_MINT]?.usdPrice ?? null;
  }
}
