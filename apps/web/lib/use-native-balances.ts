'use client';

import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { formatUnits } from 'viem';
import { useBalance } from 'wagmi';
import type { CryptoPrice, MarketFeedEvents } from '@kamby/domain';
import { subscribeToMarketFeeds } from './market-feeds';
import { solanaConnection } from './solana-config';
import { TRADE_CONFIRMED_EVENT } from './my-positions';

const REFRESH_MS = 30_000;

export type NativeChain = 'solana' | 'base' | 'bnb' | 'robinhood';

export interface NativeBalance {
  chain: NativeChain;
  symbol: 'SOL' | 'ETH' | 'BNB';
  amount: number | null;
  usd: number | null;
}

export interface NativeBalances {
  rows: NativeBalance[];
  /** All four in dollars; null until at least one is known. */
  totalUsd: number | null;
}

/** SOL / ETH / BNB in dollars, from the same live price stream as the bottom strip. */
export function useMajorPrices(enabled = true): Partial<Record<'SOL' | 'ETH' | 'BNB', number>> {
  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  useEffect(
    () =>
      !enabled || typeof EventSource === 'undefined'
        ? undefined
        : subscribeToMarketFeeds(
        (type, data) => {
          if (type === 'crypto') setPrices((data as MarketFeedEvents['crypto']).prices);
        },
        () => {},
      ),
    [enabled],
  );
  const out: Partial<Record<'SOL' | 'ETH' | 'BNB', number>> = {};
  for (const p of prices) if (p.symbol === 'SOL' || p.symbol === 'ETH' || p.symbol === 'BNB') out[p.symbol] = p.priceUsd;
  return out;
}

/**
 * Each chain's own coin in the user's wallets (2026-11-01, native-coin trading): SOL, ETH on Base,
 * BNB on BSC, ETH on Robinhood Chain — with their dollar value. Re-read every 30s and right
 * after a trade.
 */
export function useNativeBalances(evmAddress: string | undefined, solanaAddress: string | undefined): NativeBalances {
  const prices = useMajorPrices(Boolean(evmAddress || solanaAddress));
  const opts = (chainId: 8453 | 56 | 4663) => ({ address: evmAddress as `0x${string}` | undefined, chainId, query: { enabled: Boolean(evmAddress), refetchInterval: REFRESH_MS } });
  const base = useBalance(opts(8453));
  const bnb = useBalance(opts(56));
  const robinhood = useBalance(opts(4663));
  const [sol, setSol] = useState<number | null>(null);

  useEffect(() => {
    if (!solanaAddress || !solanaConnection) return;
    const connection = solanaConnection;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      connection
        .getBalance(new PublicKey(solanaAddress), 'confirmed')
        .then((lamports) => !cancelled && setSol(lamports / 1e9))
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    const afterTrade = () => [1_500, 4_000, 9_000].forEach((ms) => setTimeout(load, ms));
    window.addEventListener(TRADE_CONFIRMED_EVENT, afterTrade);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(TRADE_CONFIRMED_EVENT, afterTrade);
    };
  }, [solanaAddress]);

  useEffect(() => {
    const afterTrade = () => [1_500, 4_000, 9_000].forEach((ms) => setTimeout(() => {
      void base.refetch();
      void bnb.refetch();
      void robinhood.refetch();
    }, ms));
    window.addEventListener(TRADE_CONFIRMED_EVENT, afterTrade);
    return () => window.removeEventListener(TRADE_CONFIRMED_EVENT, afterTrade);
  }, [base, bnb, robinhood]);

  const evm = (r: typeof base) => (r.data ? Number(formatUnits(r.data.value, 18)) : null);
  const row = (chain: NativeChain, symbol: 'SOL' | 'ETH' | 'BNB', amount: number | null): NativeBalance => ({
    chain,
    symbol,
    amount,
    usd: amount !== null && prices[symbol] ? amount * prices[symbol]! : null,
  });
  const rows = [row('solana', 'SOL', sol), row('base', 'ETH', evm(base)), row('bnb', 'BNB', evm(bnb)), row('robinhood', 'ETH', evm(robinhood))];
  const known = rows.filter((r) => r.usd !== null);
  return { rows, totalUsd: known.length ? known.reduce((a, r) => a + (r.usd ?? 0), 0) : null };
}
