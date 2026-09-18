import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyEvmTypedDataSignature } from '@kamby/chain-adapters';
import { Prisma, prisma } from '@kamby/db';
import { buildRelayedSwapTypedData, normalizeEvmAddress, parseUnsignedTx, toWireTypedData, type ChainSlug, type TradeQuoteDto, type TradeTransactionDto } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { getConfiguredChains, type Env } from '../../config/env';
import { TRANSACTION_INCLUDE, toDto, type TransactionRow } from '../transaction-dto';
import { EvmGasRelayerService } from './evm-gas-relayer.service';
import { EvmRelayerWalletService } from './evm-relayer-wallet.service';

export interface RelaySwapParams {
  userId: string;
  walletAddress: string;
  quoteId: string;
  signature: string;
}

/**
 * The EVM gas relayer's HTTP-facing orchestration — see docs/GAS_RELAYER_PLAN.md's EVM
 * section. Owns exactly two things:
 *
 *  1. `attachSponsorshipIfEligible` — wraps `QuoteService#createQuote`'s already-created
 *     `TradeQuoteDto`/`TradeQuote` row; never modifies `QuoteService`'s own internals. Only
 *     when a request both asks for sponsorship and is actually eligible does this persist
 *     the row's consent-tracking fields and add the EIP-712 object to sign to the
 *     response — otherwise the response is byte-identical to today's, indistinguishable
 *     from "sponsorship wasn't requested at all" (same non-distinguishable-rejection
 *     discipline as the Solana relayer's own test-wallet gate).
 *
 *  2. `relay` — `POST /trade/relay`'s handler: verifies the EIP-712 consent signature
 *     against the row's own persisted fields (never anything the client echoes back),
 *     simulates, checks the cost ceiling, broadcasts, and persists a real
 *     `TradeTransaction` row (`sponsoredByRelayer: true`) via the exact same
 *     `toDto`/idempotency machinery `TransactionService#submitTransaction` already uses
 *     for self-paid trades.
 *
 * On "the second independent safety leg": the plan's own "applying the Piece 3 incident
 * lesson" section calls for pairing the cryptographic signature check with a check on the
 * underlying business fact, the way the WSOL fix eventually gated on `outputMint` rather
 * than instruction shape alone. For the EVM relayer specifically, that second leg is
 * *not* a redundant pre-broadcast re-comparison here — there is nothing else to compare
 * against, since the broadcast transaction's `{to, data, value}` are never sourced from
 * anywhere but this same row to begin with (see `EvmGasRelayerService`'s own "core safety
 * design" doc comment: the request DTO structurally cannot carry alternate values). The
 * real second leg is `TransactionService#refreshStatus`, completely unmodified: every
 * status refresh on the `TradeTransaction` row this method creates re-verifies the real,
 * independently-observed on-chain transaction against `row.quote.unsignedTx`
 * (`transactionMatchesQuote`) before ever marking it `CONFIRMED` — the same integrity gate
 * every self-paid trade already gets, for free, just because this flow reuses
 * `TradeTransaction` instead of a parallel table.
 */
@Injectable()
export class EvmGasRelayerQuoteService {
  private readonly chainIdToSlug: Map<number, ChainSlug>;

  constructor(
    private readonly wallet: EvmRelayerWalletService,
    private readonly relayer: EvmGasRelayerService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.chainIdToSlug = new Map(getConfiguredChains((key) => config.get(key, { infer: true })).map((c) => [c.chainId, c.slug]));
    this.logger.setContext('EvmGasRelayerQuoteService');
  }

  /**
   * `sponsorshipAvailable` is computed and returned on *every* quote, regardless of
   * `params.sponsorshipRequested` — deliberately split from the heavier
   * `consentTypedData`-attaching/DB-persisting work below, which stays gated on an actual
   * request. This is what lets the frontend (`TradePanel.tsx`) decide whether to even show
   * the gasless toggle at all: it renders only once a quote confirms `sponsorshipAvailable`,
   * so a deployment with the relayer off (or a wallet the rollout allowlist doesn't cover)
   * shows no gasless affordance whatsoever, without needing a separate capability endpoint
   * or a second, speculative "ask for sponsorship just to check" request. A minor,
   * deliberate relaxation of the allowlist gate's usual non-distinguishable-rejection
   * property, worth noting explicitly: this does let an authenticated wallet learn its own
   * allowlist status without asking for sponsorship first — acceptable for a per-user "is
   * this available to me" signal about the requester's own wallet, not a probe surface for
   * anyone else's, but worth a second look before the allowlist opens beyond an internal
   * team (see docs/GAS_RELAYER_PLAN.md's rollout section, sub-piece 4h).
   */
  async attachSponsorshipIfEligible(
    dto: TradeQuoteDto,
    params: { chainId: number; walletAddress: string; sponsorshipRequested: boolean },
  ): Promise<TradeQuoteDto> {
    const slug = this.chainIdToSlug.get(params.chainId);
    const relayerAddress = this.wallet.relayerAddress;
    const allowlist = this.wallet.testWalletAddresses;
    const walletAllowed =
      !allowlist || new Set([...allowlist].map(normalizeEvmAddress)).has(normalizeEvmAddress(params.walletAddress));
    const eligible = Boolean(slug && this.relayer.isConfigured(slug) && relayerAddress && walletAllowed);

    if (!eligible) return { ...dto, sponsorshipAvailable: false };
    if (!params.sponsorshipRequested) return { ...dto, sponsorshipAvailable: true };

    await prisma.tradeQuote.update({
      where: { id: dto.id },
      data: { sponsorshipRequested: true, relayerStatus: 'PENDING_CONSENT' },
    });

    const typedData = buildRelayedSwapTypedData({
      quoteId: dto.id,
      walletAddress: params.walletAddress,
      chainId: params.chainId,
      relayerAddress: relayerAddress!,
      unsignedTx: dto.unsignedTx,
      expiresAt: new Date(dto.expiresAt),
    });

    return { ...dto, sponsorshipAvailable: true, consentTypedData: toWireTypedData(typedData) };
  }

  async relay(params: RelaySwapParams): Promise<TradeTransactionDto> {
    const walletAddress = normalizeEvmAddress(params.walletAddress);

    // Idempotent replay guard, mirrors TransactionService#submitTransaction exactly: a
    // client retry (a flaky response the first time, or a concurrent call that lost the
    // consent-claim race below) returns the already-broadcast transaction instead of
    // erroring or double-broadcasting.
    const existingByQuote = await prisma.tradeTransaction.findUnique({ where: { quoteId: params.quoteId }, include: TRANSACTION_INCLUDE });
    if (existingByQuote) {
      if (existingByQuote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
      return toDto(existingByQuote);
    }

    const quote = await prisma.tradeQuote.findUnique({ where: { id: params.quoteId } });
    if (!quote) throw new NotFoundException(`No quote "${params.quoteId}"`);
    if (quote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
    if (normalizeEvmAddress(quote.walletAddress) !== walletAddress) {
      throw new ForbiddenException('This quote was created for a different wallet');
    }
    if (!quote.sponsorshipRequested || quote.relayerStatus === null) {
      throw new UnprocessableEntityException('This quote was not created as a sponsored (gasless) quote');
    }
    if (quote.relayerStatus !== 'PENDING_CONSENT') {
      // Already CONSENT_RECEIVED/BROADCAST/FAILED and no TradeTransaction row exists (the
      // idempotent-replay check above would have already returned one if BROADCAST
      // actually finished). Recovering a genuinely stuck CONSENT_RECEIVED row (a crash
      // between the claim and the broadcast) is deliberately out of scope for launch, same
      // as stuck-nonce recovery — see EvmRelayerNonceManagerService's own doc comment.
      throw new UnprocessableEntityException(
        `This quote's sponsorship is already ${quote.relayerStatus.toLowerCase()} — request a new quote to try again`,
      );
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      await this.markFailed(quote.id, 'Quote expired before consent was received');
      throw new UnprocessableEntityException('This quote has expired — request a new one before submitting');
    }

    const slug = this.chainIdToSlug.get(quote.chainId);
    const relayerAddress = this.wallet.relayerAddress;
    if (!slug || !relayerAddress || !this.relayer.isConfigured(slug)) {
      // Should be unreachable — attachSponsorshipIfEligible only ever sets
      // sponsorshipRequested when isConfigured was already true for this exact chain. A
      // loud failure here beats silently proceeding with a relayer that isn't real.
      throw new UnprocessableEntityException('The EVM gas relayer is not currently available for this chain');
    }

    const expectedUnsignedTx = parseUnsignedTx(quote.unsignedTx);
    if (!expectedUnsignedTx) {
      this.logger.error({ quoteId: quote.id }, 'sponsored quote has an unparseable unsignedTx — refusing to relay it');
      throw new UnprocessableEntityException('This quote can no longer be relayed — request a new one');
    }

    const typedData = buildRelayedSwapTypedData({
      quoteId: quote.id,
      walletAddress: quote.walletAddress,
      chainId: quote.chainId,
      relayerAddress,
      unsignedTx: expectedUnsignedTx,
      expiresAt: quote.expiresAt,
    });
    const signatureValid = await verifyEvmTypedDataSignature({
      address: quote.walletAddress,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: params.signature,
    });
    if (!signatureValid) {
      await this.markFailed(quote.id, 'Consent signature did not verify against this quote');
      this.logger.warn({ quoteId: quote.id }, 'relay rejected — consent signature does not verify');
      throw new ForbiddenException('This consent signature does not verify against the quote you reviewed');
    }

    // The concurrency guard against a duplicate /trade/relay call racing this one: only
    // the caller that actually wins this conditional update proceeds to spend real gas. A
    // losing concurrent call sees count === 0 here and is rejected; its own eventual retry
    // finds the TradeTransaction row this call is about to create, via the idempotent-
    // replay check at the top of this method.
    const claimed = await prisma.tradeQuote.updateMany({
      where: { id: quote.id, relayerStatus: 'PENDING_CONSENT' },
      data: { relayerStatus: 'CONSENT_RECEIVED', relayerConsentSignature: params.signature },
    });
    if (claimed.count === 0) {
      throw new UnprocessableEntityException('This quote is already being relayed — please wait for it to complete');
    }

    const relayedTx = { to: expectedUnsignedTx.to, data: expectedUnsignedTx.data, value: BigInt(expectedUnsignedTx.value) };

    const simulation = await this.relayer.simulate(slug, relayedTx);
    if (!simulation.ok) {
      await this.markFailed(quote.id, simulation.reason);
      throw new UnprocessableEntityException(`This trade would fail on-chain and was not broadcast: ${simulation.reason}`);
    }

    const ceiling = await this.relayer.checkGasCeiling(slug, simulation.gasUnits);
    if (!ceiling.ok) {
      await this.markFailed(quote.id, ceiling.reason);
      throw new UnprocessableEntityException(ceiling.reason);
    }

    const broadcast = await this.relayer.broadcast(
      slug,
      relayedTx,
      { maxFeePerGas: ceiling.maxFeePerGas, maxPriorityFeePerGas: ceiling.maxPriorityFeePerGas },
      simulation.gasUnits,
    );

    try {
      const [created] = await prisma.$transaction([
        prisma.tradeTransaction.create({
          data: {
            userId: params.userId,
            walletAddress,
            quoteId: quote.id,
            chainId: quote.chainId,
            txHash: broadcast.txHash,
            tokenMarketId: quote.tokenMarketId,
            side: quote.side,
            inputToken: quote.inputToken,
            outputToken: quote.outputToken,
            inputAmount: quote.inputAmount,
            expectedOutputAmount: quote.expectedOutputAmount,
            platformFeeAmount: quote.platformFeeAmount,
            sponsoredByRelayer: true,
            relayerFeePayer: relayerAddress,
          },
          include: TRANSACTION_INCLUDE,
        }),
        prisma.tradeQuote.update({ where: { id: quote.id }, data: { relayerStatus: 'BROADCAST', relayerNonce: broadcast.nonce } }),
      ]);
      this.logger.info({ quoteId: quote.id, txHash: broadcast.txHash, nonce: broadcast.nonce }, 'sponsored transaction broadcast');
      return toDto(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Same (chainId, txHash) or quoteId already recorded — a retry racing this one,
        // not a new trade. The broadcast itself already succeeded either way; this only
        // affects which caller's request first wrote the row.
        const existing = await prisma.tradeTransaction.findUnique({ where: { quoteId: quote.id }, include: TRANSACTION_INCLUDE });
        if (existing) return toDto(existing);
      }
      throw error;
    }
  }

  private async markFailed(quoteId: string, reason: string): Promise<void> {
    await prisma.tradeQuote.update({ where: { id: quoteId }, data: { relayerStatus: 'FAILED', relayerFailureReason: reason } });
  }

  /**
   * The fee-reimbursement leg for a sponsored trade — see docs/GAS_RELAYER_PLAN.md's EVM
   * section, "Fee-reimbursement design," Option A (confirmed 2026-09-18). Broadcasts
   * `quote.feeUnsignedTx` via the relayer only once the swap's own `CONFIRMED` transition
   * has already been observed for real — never speculatively at the next nonce — so a swap
   * that ultimately reverts never triggers a fee charge for a trade that didn't happen.
   *
   * Called from `TransactionService#getTransaction`, the one place in this codebase that
   * authoritatively re-checks a `PENDING` row against a live receipt — deliberately NOT
   * from `apps/workers`' background sweep, even though that sweep already does the
   * equivalent status-refresh work for self-paid trades. The relayer's nonce manager
   * (`EvmRelayerNonceManagerService`) only serializes broadcasts *within this process* — a
   * second process (apps/workers) broadcasting from the same relayer key would have no way
   * to coordinate nonces with this one, and could race it. Everything that touches the
   * relayer's nonce must stay inside apps/api.
   *
   * Known, named gap (not silently accepted as solved): this only runs reactively, when
   * something re-checks the row (a user polling `GET /trade/transactions/:id`, matching
   * `TradePanel.tsx`'s own `pollTransactionStatus`). A sponsored trade nobody ever
   * re-checks after its swap confirms never has its fee leg submitted — the same gap the
   * self-paid guaranteed-USDC flow already has today for an abandoned client-side fee
   * submission (no auto-retry there either). A periodic background backstop closing this
   * gap for both flows is a deliberate follow-up, not built here.
   *
   * A no-op, not an error, for: a non-sponsored row; a sponsored row with no
   * guaranteed-USDC fee eligible (`quote.feeUnsignedTx` is null); a row whose fee leg was
   * already submitted or claimed — idempotent and safe to call on every `CONFIRMED`
   * observation, including two concurrent ones (e.g. two open tabs polling the same trade),
   * only one of which will win the claim below and actually broadcast.
   *
   * If the fee leg itself fails to simulate, exceed the cost ceiling, or fails to
   * broadcast: logged loudly as a revenue-loss event and the claim is released so a later
   * poll can retry — the row's own swap `status`/`txHash` are never touched. The user's
   * trade remains a fully successful, `CONFIRMED` trade regardless of what happens here.
   */
  async submitFeeLegIfDue(row: TransactionRow): Promise<void> {
    if (!row.sponsoredByRelayer || row.feeTxHash !== null || row.feeStatus !== null) return;
    const expectedFeeUnsignedTx = parseUnsignedTx(row.quote.feeUnsignedTx);
    if (!expectedFeeUnsignedTx) return; // not a guaranteed-USDC-fee-eligible trade

    const slug = this.chainIdToSlug.get(row.chainId);
    if (!slug || !this.relayer.isConfigured(slug)) {
      this.logger.error(
        { transactionId: row.id },
        'sponsored trade confirmed but the relayer is no longer configured for this chain — fee leg cannot be submitted',
      );
      return;
    }

    // The claim guard against two concurrent observers (e.g. two open tabs polling the
    // same trade) both broadcasting the fee leg. Only the caller that wins this
    // conditional update proceeds; a losing caller simply no-ops.
    const claimed = await prisma.tradeTransaction.updateMany({
      where: { id: row.id, feeTxHash: null, feeStatus: null },
      data: { feeStatus: 'PENDING' },
    });
    if (claimed.count === 0) return;

    const feeTx = { to: expectedFeeUnsignedTx.to, data: expectedFeeUnsignedTx.data, value: BigInt(expectedFeeUnsignedTx.value) };

    const simulation = await this.relayer.simulate(slug, feeTx);
    if (!simulation.ok) {
      this.logger.error(
        { transactionId: row.id, reason: simulation.reason },
        "sponsored trade's fee leg would fail on-chain — not broadcast; this is a revenue-loss event, the user's own trade is unaffected",
      );
      await this.releaseFeeLegClaim(row.id);
      return;
    }

    const ceiling = await this.relayer.checkGasCeiling(slug, simulation.gasUnits);
    if (!ceiling.ok) {
      this.logger.error(
        { transactionId: row.id, reason: ceiling.reason },
        "sponsored trade's fee leg exceeds the relayer's cost ceiling — not broadcast; this is a revenue-loss event, the user's own trade is unaffected",
      );
      await this.releaseFeeLegClaim(row.id);
      return;
    }

    try {
      const broadcast = await this.relayer.broadcast(
        slug,
        feeTx,
        { maxFeePerGas: ceiling.maxFeePerGas, maxPriorityFeePerGas: ceiling.maxPriorityFeePerGas },
        simulation.gasUnits,
      );
      await prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { feeTxHash: broadcast.txHash, feeSubmittedAt: new Date() },
      });
      this.logger.info({ transactionId: row.id, feeTxHash: broadcast.txHash }, 'sponsored trade fee leg broadcast');
    } catch (error) {
      this.logger.error(
        { transactionId: row.id, err: error },
        "sponsored trade's fee leg failed to broadcast — this is a revenue-loss event, the user's own trade is unaffected",
      );
      await this.releaseFeeLegClaim(row.id);
    }
  }

  private async releaseFeeLegClaim(transactionId: string): Promise<void> {
    await prisma.tradeTransaction.update({ where: { id: transactionId }, data: { feeStatus: null } });
  }
}
