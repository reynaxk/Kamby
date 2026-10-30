import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { prisma } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, LIVE_LIMITS, SOLANA_USDC_MINT, liveTipFeeUsd, type LiveTipChain, type LiveTipQuote, usdcReceivedDedupeKey } from '@kamby/domain';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, http, type PublicClient } from 'viem';
import { getConfiguredChains, getSolanaConfig, type Env } from '../config/env';
import { evmChain } from '../launchpad/adapters/clanker.adapter';
import { verifyEvmTxs } from '../launchpad/adapters/evm-launch';
import { NotificationService } from '../notifications/notification.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { GasRelayerService } from '../solana/gas-relayer.service';
import { buildErc20TransferTx } from '../trading/erc20-transfer';
import { EvmGasTopupService } from '../trading/evm-gas-topup.service';
import { LiveService } from './live.service';

const EVM_CHAIN_IDS: Record<Exclude<LiveTipChain, 'solana'>, number> = { base: 8453, bnb: 56, robinhood: 4663 };

/** What a prepared tip waits on in Redis until it's signed. */
interface PendingTip {
  tipId: string;
  roomId: string;
  senderId: string;
  hostId: string;
  chain: LiveTipChain;
  wallet: string;
  amountUsd: number;
  feeUsd: number;
  solanaTx?: string;
  evmTxs?: NonNullable<LiveTipQuote['evmTransactions']>;
}

/**
 * Tips in a live room (2026-10-30, owner: "$5 minimum, 3% fee — show only the fee's amount").
 * The tip goes straight from the viewer's own wallet to the host's verified wallet, and Kamby's fee
 * in the same go — never through Kamby. Solana: one transaction, Kamby pays its network fee only.
 * EVM: two USDC transfers from the viewer's wallet, in order (the gas tank tops up gas first). Once
 * the transfers are checked on-chain, the tip appears in the room's chat and the host is told.
 */
@Injectable()
export class LiveTipsService {
  private readonly evmClients = new Map<number, PublicClient>();
  private readonly feeRecipient: `0x${string}` | null;
  private readonly treasuryUsdcAta: string | null;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly live: LiveService,
    private readonly relayer: GasRelayerService,
    private readonly gas: EvmGasTopupService,
    private readonly notifications: NotificationService,
    private readonly logger: PinoLogger,
  ) {
    for (const chain of getConfiguredChains((key) => config.get(key, { infer: true }))) {
      this.evmClients.set(chain.chainId, createPublicClient({ chain: evmChain(chain.chainId, chain.slug, 'ETH', chain.rpcUrl), transport: http(chain.rpcUrl) }) as PublicClient);
    }
    this.feeRecipient = (config.get('PLATFORM_FEE_RECIPIENT_ADDRESS', { infer: true }) as `0x${string}` | undefined) ?? null;
    this.treasuryUsdcAta = getSolanaConfig((key) => config.get(key, { infer: true }))?.treasuryUsdcAta ?? null;
    this.logger.setContext('LiveTipsService');
  }

  async prepare(me: string, roomId: string, input: { chain: LiveTipChain; amountUsd: number }): Promise<LiveTipQuote> {
    const amountUsd = Math.round(input.amountUsd * 100) / 100;
    if (!(amountUsd >= LIVE_LIMITS.tipMinUsd)) throw new BadRequestException(`The smallest tip is $${LIVE_LIMITS.tipMinUsd}.`);
    if (amountUsd > LIVE_LIMITS.tipMaxUsd) throw new BadRequestException(`The biggest tip is $${LIVE_LIMITS.tipMaxUsd.toLocaleString('en-US')}.`);
    const room = await this.live.get(roomId);
    if (room.host.userId === me) throw new BadRequestException("You can't tip yourself.");
    const feeUsd = liveTipFeeUsd(amountUsd);
    const [mine, theirs] = await Promise.all([this.wallets(me), this.wallets(room.host.userId)]);
    const tipId = randomUUID();
    const pending: PendingTip = { tipId, roomId, senderId: me, hostId: room.host.userId, chain: input.chain, wallet: '', amountUsd, feeUsd };

    if (input.chain === 'solana') {
      if (!mine.solana) throw new UnprocessableEntityException('Your Solana wallet is still being set up — try again in a moment.');
      if (!theirs.solana) throw new UnprocessableEntityException("They can't get tips on Solana yet — pick another network.");
      if (!this.treasuryUsdcAta) throw new UnprocessableEntityException('Tips on Solana are not available right now.');
      const hostAta = getAssociatedTokenAddressSync(new PublicKey(SOLANA_USDC_MINT), new PublicKey(theirs.solana), true).toBase58();
      pending.wallet = mine.solana;
      pending.solanaTx = await this.relayer.buildSponsoredUsdcTransfers({
        userWallet: mine.solana,
        transfers: [
          { toTokenAccount: hostAta, amountRaw: toRaw(amountUsd, 6) },
          { toTokenAccount: this.treasuryUsdcAta, amountRaw: toRaw(feeUsd, 6) },
        ],
      });
    } else {
      const chainId = EVM_CHAIN_IDS[input.chain];
      const usdc = EVM_USDC_BY_CHAIN_ID[chainId];
      if (!usdc || !this.evmClients.has(chainId) || !this.feeRecipient) throw new UnprocessableEntityException('Tips on this network are not available right now.');
      if (!mine.evm) throw new UnprocessableEntityException('Your wallet is still being set up — try again in a moment.');
      if (!theirs.evm) throw new UnprocessableEntityException("They can't get tips on this network yet — pick another one.");
      if ((await this.gas.ensureGas(chainId, mine.evm, usdc)) === 'stranded') throw new UnprocessableEntityException('This network is getting ready — try again in a few minutes.');
      const toHost = buildErc20TransferTx(usdc.address, theirs.evm, toRaw(amountUsd, usdc.decimals));
      const toKamby = buildErc20TransferTx(usdc.address, this.feeRecipient, toRaw(feeUsd, usdc.decimals));
      pending.wallet = mine.evm;
      pending.evmTxs = [toHost, toKamby].map((tx) => ({ chainId, to: tx.to, data: tx.data, value: '0' }));
    }

    await this.redis.set(this.key(tipId), JSON.stringify(pending), 'EX', 10 * 60);
    return { tipId, chain: input.chain, amountUsd, feeUsd, solanaTransactionBase64: pending.solanaTx, evmTransactions: pending.evmTxs };
  }

  /** The signed Solana transaction, or the EVM hashes in order — checked, then announced. */
  async submit(me: string, roomId: string, input: { tipId: string; signedTransactionBase64?: string; txHashes?: string[] }): Promise<{ ok: true; amountUsd: number }> {
    // Taken out first, so the same tip can't be announced twice.
    const raw = await this.redis.getdel(this.key(input.tipId));
    if (!raw) throw new NotFoundException('This tip expired — start it again.');
    const tip = JSON.parse(raw) as PendingTip;
    if (tip.senderId !== me || tip.roomId !== roomId) throw new ForbiddenException('This tip is not yours.');

    let txRef: string;
    if (tip.chain === 'solana') {
      if (!input.signedTransactionBase64 || !tip.solanaTx) throw new BadRequestException('Sign the tip first.');
      txRef = await this.relayer.submitSponsoredUsdcTransfers({ userWallet: tip.wallet, expectedUnsignedTxBase64: tip.solanaTx, partiallySignedTxBase64: input.signedTransactionBase64 });
    } else {
      const client = this.evmClients.get(EVM_CHAIN_IDS[tip.chain]);
      if (!client || !tip.evmTxs) throw new UnprocessableEntityException('Tips on this network are not available right now.');
      await verifyEvmTxs(client, tip.wallet, tip.evmTxs, { txHashes: input.txHashes ?? [] });
      txRef = input.txHashes![0]!;
    }

    this.logger.info({ roomId, tipId: tip.tipId, chain: tip.chain, amountUsd: tip.amountUsd }, 'live tip sent');
    await this.live.announceTip(roomId, me, tip.amountUsd).catch((error: unknown) => this.logger.warn({ err: error }, 'Live tip line failed'));
    await this.notifications
      .create({
        userId: tip.hostId,
        type: 'USDC_RECEIVED',
        dedupeKey: usdcReceivedDedupeKey(txRef),
        actorUserId: me,
        payload: { amountUsd: tip.amountUsd, chainIdentifier: tip.chain === 'solana' ? 'solana' : `eip155:${EVM_CHAIN_IDS[tip.chain]}` },
      })
      .catch(() => undefined);
    return { ok: true, amountUsd: tip.amountUsd };
  }

  private key(tipId: string) {
    return `kamby:live:tip:${tipId}`;
  }

  private async wallets(userId: string): Promise<{ evm: string | null; solana: string | null }> {
    const rows = await prisma.wallet.findMany({ where: { userId, verifiedAt: { not: null } }, select: { address: true, chain: true }, orderBy: { verifiedAt: 'asc' } });
    return { evm: rows.find((w) => w.chain === 'EVM')?.address ?? null, solana: rows.find((w) => w.chain === 'SOLANA')?.address ?? null };
  }
}

/** Dollars to the token's smallest unit, exactly (cents first, so no float drift). */
export function toRaw(usd: number, decimals: number): bigint {
  return (BigInt(Math.round(usd * 100)) * 10n ** BigInt(decimals)) / 100n;
}
