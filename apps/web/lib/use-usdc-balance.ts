'use client';

import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { SOLANA_USDC_MINT } from '@kamby/domain';
import { erc20Abi, formatUnits } from 'viem';
import { useReadContracts } from 'wagmi';
import { solanaConnection } from './solana-config';
import { USDC_BY_CHAIN_ID } from './usdc';

const REFRESH_MS = 30_000;

export interface UsdcBalances {
  base: number | null;
  bnb: number | null;
  solana: number | null;
  /** Sum of whatever loaded; null until at least one chain has. */
  total: number | null;
}

/** Exported for tests. Totals the chains that loaded — a chain still loading counts as 0. */
export function totalUsdc(parts: (number | null)[]): number | null {
  const loaded = parts.filter((p): p is number => p !== null);
  return loaded.length === 0 ? null : loaded.reduce((a, b) => a + b, 0);
}

/**
 * The user's USDC across Base, BNB Chain and Solana — one number, the way Kamby shows a
 * balance (users only ever hold USDC, product decision 2026-10-02). EVM reads go through the
 * browser's own public RPCs (wagmi), Solana through the browser's Helius key — never the
 * API's paid RPC. Refreshes every 30s, only while the tab is visible.
 */
export function useUsdcBalances(evmAddress: string | undefined, solanaAddress: string | undefined): UsdcBalances {
  const base = USDC_BY_CHAIN_ID[8453]!;
  const bnb = USDC_BY_CHAIN_ID[56]!;
  const { data } = useReadContracts({
    contracts: evmAddress
      ? [
          { chainId: 8453, address: base.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [evmAddress as `0x${string}`] },
          { chainId: 56, address: bnb.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [evmAddress as `0x${string}`] },
        ]
      : [],
    query: { enabled: Boolean(evmAddress), refetchInterval: REFRESH_MS },
  });
  const read = (i: number, decimals: number) => {
    const r = data?.[i];
    return r && r.status === 'success' ? Number(formatUnits(r.result as bigint, decimals)) : null;
  };
  const baseUsdc = read(0, base.decimals);
  const bnbUsdc = read(1, bnb.decimals);

  const [solanaUsdc, setSolanaUsdc] = useState<number | null>(null);
  useEffect(() => {
    if (!solanaAddress || !solanaConnection) return;
    const connection = solanaConnection;
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(solanaAddress), { mint: new PublicKey(SOLANA_USDC_MINT) });
        const sum = accounts.value.reduce((acc, a) => acc + Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
        if (!cancelled) setSolanaUsdc(sum);
      } catch {
        // Keep the last value; next refresh retries.
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [solanaAddress]);

  return { base: baseUsdc, bnb: bnbUsdc, solana: solanaUsdc, total: totalUsdc([baseUsdc, bnbUsdc, solanaUsdc]) };
}
