import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressLookupTableAccount, Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { prisma } from '@kamby/db';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';
import { validateRelayerInstructions, type ResolvedInstruction } from './gas-relayer-instruction-guard';

/** The SPL Token Account rent-exemption minimum (165-byte account) as of 2026-09-13 —
 *  stable for a very long time, but a real network parameter, not a protocol constant;
 *  re-verify against `connection.getMinimumBalanceForRentExemption(165)` before relying on
 *  this for real money, rather than trusting this hardcoded figure indefinitely. */
const ATA_RENT_LAMPORTS = 2_039_280;

export interface GasRelayerSubmitParams {
  userId: string;
  walletAddress: string;
  quoteId: string;
  /** Base64-encoded `VersionedTransaction` bytes, already signed by the user's own wallet
   *  in its own signer slot — this service refuses to ever be the first/only signer, see
   *  `assertUserAlreadySigned` below. */
  partiallySignedTxBase64: string;
}

export interface GasRelayerSubmitResult {
  signature: string;
}

/**
 * NOT WIRED UP — see gas-relayer-instruction-guard.ts's own top doc comment for what that
 * means concretely (no module registers this, no route exposes it, its env vars are
 * genuinely optional). Written now, deployed later, per the plan locked in 2026-09-13 — see
 * docs/GAS_RELAYER_PLAN.md for the full design, the companion piece this file deliberately
 * does NOT implement (constructing the sponsored-fee-payer transaction in the first place —
 * needs Jupiter's `/swap-instructions` endpoint rather than `/swap`, re-verify against
 * Jupiter's current docs before building it), and the launch-scope reasoning for why this
 * stays deferred.
 *
 * This class is the *co-signing* half only: given a transaction the user's own embedded
 * wallet already partially signed (fee payer slot left for this service), validate it
 * exhaustively, then — and only then — add this backend's own signature as fee payer and
 * broadcast. Every check below is cheap-rejects-first, ordered so a malicious or malformed
 * request fails as early as possible, before any RPC call: deserialize → re-derive quote
 * and wallet ownership from the DB (never trust the client's claim) → fee-payer identity →
 * user-already-signed → instruction allowlist (gas-relayer-instruction-guard.ts) → simulate
 * → balance-ceiling check against the simulation → only then co-sign and broadcast.
 */
@Injectable()
export class GasRelayerService {
  private readonly connection: Connection | null;
  private readonly feePayerKeypair: Keypair | null;
  private readonly maxLamportsCeiling: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
    this.connection = solanaConfig ? new Connection(solanaConfig.rpcUrl, 'confirmed') : null;
    // Never logged — see the `redact` config in app.module.ts, which already anticipates a
    // `*.privateKey`/`*.secretKey` path, same discipline as SolanaTopupService's own key.
    this.feePayerKeypair =
      solanaConfig?.gasRelayerFeePayerSecretKey != null ? Keypair.fromSecretKey(bs58.decode(solanaConfig.gasRelayerFeePayerSecretKey)) : null;
    // ~one signature fee (5,000 lamports) + one ATA-creation rent (~2,039,280 lamports),
    // with real headroom — not a precise budget, a hard backstop that catches anything the
    // instruction allowlist itself might have missed. Defense in depth, not the primary
    // control (see step 7 in docs/GAS_RELAYER_PLAN.md).
    this.maxLamportsCeiling = solanaConfig?.gasRelayerMaxLamportsCeiling ?? 3_000_000;
    this.logger.setContext('GasRelayerService');
  }

  async submitSponsoredTransaction(params: GasRelayerSubmitParams): Promise<GasRelayerSubmitResult> {
    if (!this.connection || !this.feePayerKeypair) {
      throw new UnprocessableEntityException('The gas relayer is not configured on this deployment');
    }
    const connection = this.connection;
    const feePayerKeypair = this.feePayerKeypair;

    // 1. Cheap structural checks first — no RPC calls yet.
    const transaction = deserializeOrThrow(params.partiallySignedTxBase64);

    // 2. Re-derive quote and wallet ownership from the DB — never trust the client's own
    //    claim about which quote/wallet this transaction is for, same discipline
    //    SolanaTransactionService#submitTransaction and SolanaQuoteService already apply.
    const quote = await prisma.solanaTradeQuote.findUnique({ where: { id: params.quoteId } });
    if (!quote) throw new NotFoundException(`No quote "${params.quoteId}"`);
    if (quote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
    if (quote.walletAddress !== params.walletAddress) throw new ForbiddenException('This quote was created for a different wallet');
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new UnprocessableEntityException('This quote has expired — request a new one before submitting');
    }

    const wallet = await prisma.wallet.findUnique({ where: { address: params.walletAddress } });
    if (!wallet || wallet.userId !== params.userId || wallet.verifiedAt === null || wallet.chain !== 'SOLANA') {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }

    // 3. Resolve every account this transaction actually touches, address-lookup-table
    //    indirection included — everything from here on needs this to be trustworthy, so
    //    it happens before any of the identity/allowlist checks that depend on it.
    const lookupTableAccounts = await resolveLookupTables(connection, transaction);
    const accountKeys = transaction.message.getAccountKeys({ addressLookupTableAccounts: lookupTableAccounts });

    // 4. Fee-payer identity — account index 0 is always the fee payer, by protocol
    //    convention, not this code's assumption.
    const feePayerAccount = accountKeys.get(0);
    if (!feePayerAccount || !feePayerAccount.equals(feePayerKeypair.publicKey)) {
      throw new ForbiddenException("This transaction's fee payer is not this relayer — refusing to sign");
    }

    // 5. The user's own signer slot must already carry a valid signature. This relayer
    //    never signs first and never signs alone — see this class's own doc comment.
    assertUserAlreadySigned(transaction, wallet.address, accountKeys);

    // 6. Instruction allowlist — the named, tested security core (see
    //    gas-relayer-instruction-guard.ts and its adversarial .spec.ts).
    const resolvedInstructions: ResolvedInstruction[] = transaction.message.compiledInstructions.map((ix) => {
      const programId = accountKeys.get(ix.programIdIndex);
      if (!programId) throw new UnprocessableEntityException('Transaction references an unresolvable program account');
      return { programId: programId.toBase58(), data: ix.data };
    });
    const guardResult = validateRelayerInstructions(resolvedInstructions);
    if (!guardResult.ok) {
      this.logger.warn({ userId: params.userId, walletAddress: params.walletAddress, reason: guardResult.reason }, 'gas relayer rejected transaction');
      throw new ForbiddenException(guardResult.reason);
    }

    // 7. Simulate before ever touching the real fee-payer key — reject on any simulation
    //    error. Catches anything malformed or doomed to fail on-chain that the allowlist
    //    itself wouldn't (e.g. an account that doesn't exist, an instruction with the right
    //    program/discriminator but nonsensical account ordering).
    const simulation = await connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true });
    if (simulation.value.err) {
      this.logger.warn({ err: simulation.value.err }, 'gas relayer transaction failed simulation');
      throw new UnprocessableEntityException('This transaction failed simulation and was not sponsored');
    }

    // 8. Hard balance-ceiling backstop — defense in depth, not the primary control (step 6
    //    already rejects the one known attack shape; this exists in case that allowlist
    //    logic itself has a bug). Computed exactly, not estimated: `getFeeForMessage` gives
    //    the real signature-fee cost for this specific message, and the allowlist already
    //    guarantees the only other lamports this fee payer could ever owe is ATA-creation
    //    rent (CloseAccount is rejected outright, so rent this fee payer pays for is never
    //    reclaimed by anyone mid-transaction) — so a worst-case bound is exact, not a guess.
    const feeResult = await connection.getFeeForMessage(transaction.message, 'confirmed');
    const signatureFeeLamports = feeResult.value ?? 0;
    const ataCreateCount = resolvedInstructions.filter((ix) => ix.programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()).length;
    const worstCaseLamports = signatureFeeLamports + ataCreateCount * ATA_RENT_LAMPORTS;
    if (worstCaseLamports > this.maxLamportsCeiling) {
      this.logger.warn({ worstCaseLamports, ceiling: this.maxLamportsCeiling }, 'gas relayer rejected: worst-case cost exceeds ceiling');
      throw new ForbiddenException('This transaction could cost more than this relayer is willing to sponsor');
    }

    // 9. Only now: co-sign as fee payer and broadcast.
    transaction.sign([feePayerKeypair]);
    const signature = await connection.sendTransaction(transaction, { skipPreflight: false, maxRetries: 3 });
    this.logger.info({ userId: params.userId, walletAddress: params.walletAddress, quoteId: quote.id, signature }, 'gas relayer sponsored and broadcast a transaction');

    return { signature };
  }
}

function deserializeOrThrow(base64: string): VersionedTransaction {
  try {
    const bytes = Buffer.from(base64, 'base64');
    return VersionedTransaction.deserialize(bytes);
  } catch {
    throw new UnprocessableEntityException('Malformed transaction bytes');
  }
}

async function resolveLookupTables(connection: Connection, transaction: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  const lookups = transaction.message.addressTableLookups;
  if (!lookups || lookups.length === 0) return [];
  const resolved = await Promise.all(
    lookups.map(async (lookup) => {
      const { value } = await connection.getAddressLookupTable(lookup.accountKey);
      if (!value) throw new UnprocessableEntityException(`Referenced address lookup table ${lookup.accountKey.toBase58()} could not be resolved`);
      return value;
    }),
  );
  return resolved;
}

/**
 * Finds the user's wallet among this transaction's required-signature slots (the first
 * `message.header.numRequiredSignatures` static account keys, positionally matching
 * `transaction.signatures`) and confirms that slot is not still an all-zero placeholder —
 * the representation `VersionedTransaction` uses for "not signed yet." Throws if the user's
 * wallet isn't a required signer at all, or is a required signer but hasn't actually signed.
 */
function assertUserAlreadySigned(
  transaction: VersionedTransaction,
  userWalletAddress: string,
  accountKeys: ReturnType<VersionedTransaction['message']['getAccountKeys']>,
): void {
  const numRequiredSignatures = transaction.message.header.numRequiredSignatures;
  let userSignerIndex = -1;
  for (let i = 0; i < numRequiredSignatures; i++) {
    const account = accountKeys.get(i);
    if (account && account.toBase58() === userWalletAddress) {
      userSignerIndex = i;
      break;
    }
  }
  if (userSignerIndex === -1) {
    throw new ForbiddenException("This transaction does not require the caller's own wallet to sign it");
  }
  const signature = transaction.signatures[userSignerIndex];
  const isPlaceholder = !signature || signature.every((byte) => byte === 0);
  if (isPlaceholder) {
    throw new ForbiddenException("This transaction has not actually been signed by the caller's wallet yet");
  }
}
