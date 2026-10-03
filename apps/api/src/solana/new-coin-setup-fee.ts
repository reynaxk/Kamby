import { SOLANA_USDC_MINT } from '@kamby/domain';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';

/** Rent Kamby's relayer pays to open a token account: classic SPL Token / Token-2022 (with
 *  the immutable-owner extension Jupiter's idempotent create adds). */
const ATA_RENT_LAMPORTS = { token: 2_039_280n, token2022: 2_074_080n } as const;
const MIN_SETUP_FEE_USDC_RAW = 100_000n; // $0.10
/** Used only if SOL's price can't be fetched — deliberately high, so Kamby never undercharges. */
const FALLBACK_SOL_USD = 250;
const PRICE_TTL_MS = 60_000;
let solPrice: { usd: number; at: number } | null = null;

/** Exported for tests. USDC (6 decimals) covering `rentLamports` at `solUsd`, rounded up to the cent. */
export function setupFeeUsdcRaw(rentLamports: bigint, solUsd: number): bigint {
  const usd = (Number(rentLamports) / 1e9) * solUsd;
  const cents = BigInt(Math.ceil(usd * 100));
  const raw = cents * 10_000n;
  return raw > MIN_SETUP_FEE_USDC_RAW ? raw : MIN_SETUP_FEE_USDC_RAW;
}

async function solUsd(): Promise<number> {
  if (solPrice && Date.now() - solPrice.at < PRICE_TTL_MS) return solPrice.usd;
  try {
    const res = await fetch('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(4000) });
    const body = (await res.json()) as Record<string, { usdPrice?: number }>;
    const usd = body['So11111111111111111111111111111111111111112']?.usdPrice;
    if (typeof usd === 'number' && usd > 0) {
      solPrice = { usd, at: Date.now() };
      return usd;
    }
  } catch {
    // fall through
  }
  return solPrice?.usd ?? FALLBACK_SOL_USD;
}

/**
 * The "new coin setup" charge (user decision 2026-10-03). On a gasless buy, Kamby's relayer
 * pays the rent to open the user's token account for a coin they've never held (~0.002 SOL,
 * ~$0.30) — and that rent goes back to the *user* if the account is ever closed, never to
 * Kamby. So when that account doesn't exist yet, the buy carries a USDC charge of the same
 * value, sent from the user's USDC account to Kamby's treasury in the same transaction. Zero
 * when the account already exists. One RPC call (mint + account together).
 */
export async function resolveNewCoinSetupFee(
  connection: Connection,
  walletAddress: string,
  mint: string,
): Promise<bigint> {
  const owner = new PublicKey(walletAddress);
  const mintKey = new PublicKey(mint);
  const mintInfo = await connection.getAccountInfo(mintKey);
  const isToken2022 = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ?? false;
  const ata = getAssociatedTokenAddressSync(mintKey, owner, false, isToken2022 ? TOKEN_2022_PROGRAM_ID : undefined);
  const existing = await connection.getAccountInfo(ata);
  if (existing) return 0n;
  return setupFeeUsdcRaw(isToken2022 ? ATA_RENT_LAMPORTS.token2022 : ATA_RENT_LAMPORTS.token, await solUsd());
}

/** The USDC transfer that collects the charge: user's USDC account → Kamby's treasury. */
export function setupFeeInstruction(walletAddress: string, treasuryUsdcAta: string, amountRaw: bigint): TransactionInstruction {
  const owner = new PublicKey(walletAddress);
  const usdc = new PublicKey(SOLANA_USDC_MINT);
  return createTransferCheckedInstruction(getAssociatedTokenAddressSync(usdc, owner), usdc, new PublicKey(treasuryUsdcAta), owner, amountRaw, 6);
}
