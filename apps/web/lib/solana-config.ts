import { Connection } from '@solana/web3.js';
import { clientEnv } from './env';

/**
 * Solana trading — see docs/TRADING.md#solana. `null` when NEXT_PUBLIC_SOLANA_RPC_URL
 * isn't configured, mirroring privy-config.ts's `privyAppId` — every consumer must handle
 * "not configured" explicitly. A read-only connection the *browser* uses directly (balance
 * checks, confirmation polling) — never the same trust boundary as apps/api's own
 * SOLANA_RPC_URL, same reasoning wagmi-config.ts already documents for
 * NEXT_PUBLIC_CHAIN_RPC_URL.
 */
export const solanaConnection = clientEnv.NEXT_PUBLIC_SOLANA_RPC_URL
  ? new Connection(clientEnv.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed')
  : null;
