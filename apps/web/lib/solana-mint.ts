'use client';

import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { SOLANA_NATIVE_MINT } from '@kamby/domain';
import { solanaConnection } from '@/lib/solana-config';

const NATIVE_SOL_DECIMALS = 9;

/**
 * A mint's decimals, read from the mint account itself — the API's Solana market rows carry
 * `decimals: null` (Jupiter's price feed doesn't return it), and a hardcoded per-token table
 * here would silently drift from the curated list in apps/workers. `null` while loading or
 * if the RPC is unreachable; callers must then fall back to showing raw units, never guess.
 */
export function useMintDecimals(mint: string): number | null {
  const [decimals, setDecimals] = useState<number | null>(mint === SOLANA_NATIVE_MINT ? NATIVE_SOL_DECIMALS : null);

  useEffect(() => {
    if (mint === SOLANA_NATIVE_MINT) {
      setDecimals(NATIVE_SOL_DECIMALS);
      return;
    }
    setDecimals(null);
    if (!solanaConnection) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await solanaConnection!.getParsedAccountInfo(new PublicKey(mint), 'confirmed');
        const data = info.value?.data;
        const parsed = data && typeof data === 'object' && 'parsed' in data ? (data.parsed as { info?: { decimals?: unknown } }) : null;
        const value = parsed?.info?.decimals;
        if (!cancelled && typeof value === 'number') setDecimals(value);
      } catch {
        // Unknown stays unknown — see this hook's doc comment.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mint]);

  return decimals;
}

/** Formats a raw integer amount with `decimals`, or labels it honestly as raw units when
 *  the decimals aren't known. */
export function formatTokenAmount(raw: string, decimals: number | null, symbol: string | null): string {
  if (decimals === null) return `${raw} raw units`;
  const value = Number(raw) / 10 ** decimals;
  const digits = value >= 1000 ? 0 : value >= 1 ? 4 : 6;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits })} ${symbol ?? 'tokens'}`;
}
