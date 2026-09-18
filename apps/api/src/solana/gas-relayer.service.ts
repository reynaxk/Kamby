import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressLookupTableAccount, Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { Prisma, prisma } from '@kamby/db';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';
import { validateRelayerInstructions, type ResolvedInstruction } from './gas-relayer-instruction-guard';
import { parseSolanaUnsignedTx, solanaTransactionMatchesQuote } from './solana-quote-match';
import { toDto, type SolanaTradeTransactionDto } from './solana-transaction.service';

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

export type GasRelayerSubmitResult = SolanaTradeTransactionDto;

/**
 * Wired up as of 2026-09-17 (`solana.module.ts` registers this; `POST
 * /solana/transactions/sponsored` on `solana.controller.ts` exposes it) but still safely
 * inert on every real deployment — `SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY` is unset in
 * production, so every method below fails fast with a clean "not configured" error rather
 * than a crash. See docs/GAS_RELAYER_PLAN.md for the full design and the operational work
 * (funding a keypair, a boot-time enable flag, treasury monitoring, a live devnet
 * adversarial pass) still standing between this and a real launch.
 *
 * This class is the *co-signing* half: given a transaction the user's own embedded wallet
 * already partially signed (fee payer slot left for this service), validate it
 * exhaustively, then — and only then — add this backend's own signature as fee payer,
 * broadcast, and persist. `SolanaQuoteService#createSponsoredQuote` (via
 * `gas-relayer-transaction-builder.ts`) is the companion piece that constructs the
 * transaction in the first place; this class never builds one itself. Every check below is
 * cheap-rejects-first, ordered so a malicious or malformed request fails as early as
 * possible, before any RPC call: deserialize → re-derive quote and wallet ownership from
 * the DB (never trust the client's claim) → confirm the submitted transaction is
 * byte-for-byte the one this quote actually described (`solana-quote-match.ts` — the
 * Solana analogue of `@kamby/domain`'s `transactionMatchesQuote`, checked pre-broadcast
 * here rather than only post-hoc, since this is the one Solana flow where a mismatch could
 * mean this backend's own relayer funds a transaction it never reviewed) → fee-payer
 * identity → user-already-signed → instruction allowlist
 * (gas-relayer-instruction-guard.ts, which structurally matches any permitted WSOL close to
 * a same-tx creation but can't itself confirm that account is genuinely fresh) → a live
 * pre-existence check for any such matched close → simulate → balance-ceiling check against
 * the simulation → only then co-sign, broadcast, and persist.
 */
@Injectable()
export class GasRelayerService {
  private readonly connection: Connection | null;
  private readonly feePayerKeypair: Keypair | null;
  private readonly maxLamportsCeiling: number;
  private readonly testWalletAddresses: ReadonlySet<string> | null;

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
    this.testWalletAddresses = solanaConfig?.gasRelayerTestWalletAddresses ?? null;
    this.logger.setContext('GasRelayerService');
  }

  /** The relayer's own public key — safe to expose (it's not the secret half), and needed
   *  by the sponsored-quote flow (`SolanaQuoteService#createSponsoredQuote`) to tell
   *  Jupiter's `/swap-instructions` who should fund the setup instructions. `null` when
   *  this deployment has no relayer configured, same as every other "not wired up" state
   *  this class already exposes via `submitSponsoredTransaction`'s own check. */
  get feePayerPublicKey(): string | null {
    return this.feePayerKeypair?.publicKey.toBase58() ?? null;
  }

  /** The relayer's own RPC connection — exposed so the sponsored-quote flow
   *  (`gas-relayer-transaction-builder.ts`, called from `SolanaQuoteService`) can resolve
   *  address lookup tables through the same connection this class itself uses for
   *  everything else, rather than constructing a second RPC client for one read-only
   *  purpose. `null` under the same "not configured" condition as every other accessor
   *  here. */
  get relayerConnection(): Connection | null {
    return this.connection;
  }

  async submitSponsoredTransaction(params: GasRelayerSubmitParams): Promise<GasRelayerSubmitResult> {
    // Idempotency, checked first, before even the "is this deployment configured" check —
    // a client retry (e.g. after a network blip on the original response) must return the
    // already-persisted result, never attempt to re-broadcast or double-relay. Same
    // contract as SolanaTransactionService#submitTransaction's own existingByQuote check.
    const existingByQuote = await prisma.solanaTradeTransaction.findUnique({ where: { quoteId: params.quoteId } });
    if (existingByQuote) {
      if (existingByQuote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
      return toDto(existingByQuote);
    }

    if (!this.connection || !this.feePayerKeypair) {
      throw new UnprocessableEntityException('The gas relayer is not configured on this deployment');
    }
    // A rollout gate, not a security boundary — see SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES's
    // own doc comment (config/env.ts) and SolanaQuoteService#createSponsoredQuote's matching
    // check. Same exact rejection message as "not configured at all" above, deliberately —
    // never distinguishable from the outside as "you're just not on the allowlist yet."
    if (this.testWalletAddresses !== null && !this.testWalletAddresses.has(params.walletAddress)) {
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

    // 2b. The transaction must be byte-for-byte the one this quote actually described — the
    //     instruction allowlist below only enforces a generic *shape* (an allowlisted
    //     program, exactly one Jupiter instruction); it was never designed to catch a
    //     shape-valid transaction that's simply the *wrong* swap riding on the caller's own
    //     valid, unexpired quote id (different amounts, a different fee account, a
    //     different mint entirely). See solana-quote-match.ts's own doc comment — this is
    //     the Solana analogue of @kamby/domain's transactionMatchesQuote (EVM), checked here
    //     rather than only post-hoc, since sponsored trades are the one Solana flow where a
    //     mismatch could mean this backend's own relayer funds a transaction it never
    //     actually reviewed.
    const expectedUnsignedTxBase64 = parseSolanaUnsignedTx(quote.unsignedTx);
    if (expectedUnsignedTxBase64 === null || !solanaTransactionMatchesQuote(transaction, expectedUnsignedTxBase64)) {
      this.logger.warn({ userId: params.userId, walletAddress: params.walletAddress, quoteId: quote.id }, 'gas relayer rejected: submitted transaction does not match the quoted trade');
      throw new ForbiddenException('This transaction does not match the trade you were quoted');
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
    //    gas-relayer-instruction-guard.ts and its adversarial .spec.ts). `accounts` (added
    //    alongside the WSOL-unwrap fix) lets the guard cross-reference a CloseAccount
    //    against an earlier same-transaction ATA creation — resolved through the same
    //    already-validated `accountKeys` every other identity check here uses.
    const resolvedInstructions: ResolvedInstruction[] = transaction.message.compiledInstructions.map((ix) => {
      const programId = accountKeys.get(ix.programIdIndex);
      if (!programId) throw new UnprocessableEntityException('Transaction references an unresolvable program account');
      const accounts = ix.accountKeyIndexes.map((idx) => {
        const account = accountKeys.get(idx);
        if (!account) throw new UnprocessableEntityException('Transaction references an unresolvable account');
        return account.toBase58();
      });
      return { programId: programId.toBase58(), data: ix.data, accounts };
    });
    const guardResult = validateRelayerInstructions(resolvedInstructions, {
      // Jupiter's real WSOL-unwrap cleanup refunds the account's owner (the user), not the
      // fee payer — both are legitimate destinations; see the guard's own doc comment.
      acceptableCloseDestinations: [feePayerKeypair.publicKey.toBase58(), wallet.address],
    });
    if (!guardResult.ok) {
      this.logger.warn({ userId: params.userId, walletAddress: params.walletAddress, reason: guardResult.reason }, 'gas relayer rejected transaction');
      throw new ForbiddenException(guardResult.reason);
    }

    // 6b. The guard can structurally match a close to a same-tx creation but can't confirm
    //     that account didn't already exist *before* this transaction — the
    //     `CreateIdempotent` bypass its own doc comment describes. A live check closes that
    //     gap; only reachable at all when a close was actually permitted, i.e. never on the
    //     common no-WSOL-involved path.
    for (const target of guardResult.wsolClosesRequiringFreshnessCheck) {
      const info = await connection.getAccountInfo(new PublicKey(target), 'confirmed');
      if (info !== null) {
        this.logger.warn({ userId: params.userId, walletAddress: params.walletAddress, target }, 'gas relayer rejected: WSOL close targets an account that already existed before this transaction');
        throw new ForbiddenException('This transaction closes a token account that was not created fresh by this same transaction');
      }
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
    //    already rejects everything outside a narrow, matched allowlist; this exists in
    //    case that logic itself has a bug). Computed exactly, not estimated:
    //    `getFeeForMessage` gives the real signature-fee cost for this specific message,
    //    and the allowlist already guarantees the only other lamports this fee payer could
    //    ever owe is ATA-creation rent. Still exact even with a WSOL close now sometimes
    //    permitted: every ATA-create's rent is already priced here as a sunk cost
    //    regardless of whether a later, matched close follows it — the close only ever
    //    refunds that rent to the *destination* account (the user's wallet or the fee
    //    payer itself; never a third party, per the guard's own check), so it can only ever
    //    make this fee payer's real net cost lower than this worst-case bound, never higher.
    const feeResult = await connection.getFeeForMessage(transaction.message, 'confirmed');
    const signatureFeeLamports = feeResult.value ?? 0;
    const ataCreateCount = resolvedInstructions.filter((ix) => ix.programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()).length;
    const worstCaseLamports = signatureFeeLamports + ataCreateCount * ATA_RENT_LAMPORTS;
    if (worstCaseLamports > this.maxLamportsCeiling) {
      this.logger.warn({ worstCaseLamports, ceiling: this.maxLamportsCeiling }, 'gas relayer rejected: worst-case cost exceeds ceiling');
      throw new ForbiddenException('This transaction could cost more than this relayer is willing to sponsor');
    }

    // 9. Only now: co-sign as fee payer, broadcast, and persist.
    transaction.sign([feePayerKeypair]);
    const signature = await connection.sendTransaction(transaction, { skipPreflight: false, maxRetries: 3 });
    this.logger.info({ userId: params.userId, walletAddress: params.walletAddress, quoteId: quote.id, signature }, 'gas relayer sponsored and broadcast a transaction');

    return this.persistSponsoredTransaction(params, quote, signature, feePayerKeypair.publicKey.toBase58());
  }

  /** Broadcasting above already succeeded — the on-chain effect is real and irreversible by
   *  the time this runs, so a persistence failure here must never look like the trade
   *  itself failed. Same P2002-recovery shape as
   *  SolanaTransactionService#submitTransaction's own create — a duplicate can only arise
   *  from a genuine race (two concurrent calls past the idempotency check above), never a
   *  meaningful conflict, so recovering by re-reading is always correct. */
  private async persistSponsoredTransaction(
    params: GasRelayerSubmitParams,
    quote: NonNullable<Awaited<ReturnType<typeof prisma.solanaTradeQuote.findUnique>>>,
    signature: string,
    relayerFeePayer: string,
  ): Promise<SolanaTradeTransactionDto> {
    try {
      const created = await prisma.solanaTradeTransaction.create({
        data: {
          userId: params.userId,
          walletAddress: params.walletAddress,
          quoteId: quote.id,
          signature,
          side: quote.side,
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          inputAmount: quote.inputAmount,
          expectedOutputAmount: quote.expectedOutputAmount,
          platformFeeAmount: quote.platformFeeAmount,
          sponsoredByRelayer: true,
          relayerFeePayer,
        },
      });
      this.logger.info({ transactionId: created.id, signature }, 'sponsored solana trade persisted');
      return toDto(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.solanaTradeTransaction.findUnique({ where: { signature } });
        if (existing) return toDto(existing);
      }
      throw error;
    }
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
