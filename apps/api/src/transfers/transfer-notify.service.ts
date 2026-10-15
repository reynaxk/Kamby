import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, SOLANA_USDC_MINT, usdcReceivedDedupeKey } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, decodeEventLog, erc20Abi, http, isAddressEqual, type Hex, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../config/env';
import { evmChain } from '../launchpad/adapters/clanker.adapter';
import { NotificationService } from '../notifications/notification.service';
import { GasRelayerService } from '../solana/gas-relayer.service';

const EVM_CHAIN_IDS: Record<string, number> = { base: 8453, bnb: 56, robinhood: 4663 };

/**
 * "@x sent you $5" (2026-10-15): after a user sends USDC to another Kamby user by @username, the
 * app reports the transaction here; the recipient is notified (in-app + phone push) only once the
 * transaction is found on-chain moving USDC from one of the sender's verified wallets to the
 * recipient's verified wallet — so nobody can fake a payment notification. One per transaction.
 */
@Injectable()
export class TransferNotifyService {
  private readonly evmClients = new Map<number, PublicClient>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly notifications: NotificationService,
    private readonly solana: GasRelayerService,
    private readonly logger: PinoLogger,
  ) {
    for (const chain of getConfiguredChains((key) => config.get(key, { infer: true }))) {
      this.evmClients.set(chain.chainId, createPublicClient({ chain: evmChain(chain.chainId, chain.slug, 'ETH', chain.rpcUrl), transport: http(chain.rpcUrl) }) as PublicClient);
    }
    this.logger.setContext('TransferNotifyService');
  }

  async notify(senderId: string, input: { username: string; chain: string; txRef: string }): Promise<{ notified: boolean; amountUsd: number }> {
    const recipient = await prisma.user.findUnique({
      where: { username: input.username.replace(/^@/, '').toLowerCase() },
      select: { id: true, wallets: { where: { verifiedAt: { not: null } }, select: { address: true, chain: true } } },
    });
    if (!recipient) throw new NotFoundException('No Kamby user with that name.');
    if (recipient.id === senderId) throw new BadRequestException("That's you.");
    const senderWallets = await prisma.wallet.findMany({ where: { userId: senderId, verifiedAt: { not: null } }, select: { address: true, chain: true } });

    const amountUsd =
      input.chain === 'solana'
        ? await this.solanaAmount(input.txRef, senderWallets.filter((w) => w.chain === 'SOLANA').map((w) => w.address), recipient.wallets.filter((w) => w.chain === 'SOLANA').map((w) => w.address))
        : await this.evmAmount(input.chain, input.txRef, senderWallets.filter((w) => w.chain === 'EVM').map((w) => w.address), recipient.wallets.filter((w) => w.chain === 'EVM').map((w) => w.address));

    await this.notifications.create({
      userId: recipient.id,
      type: 'USDC_RECEIVED',
      dedupeKey: usdcReceivedDedupeKey(input.txRef),
      actorUserId: senderId,
      payload: { amountUsd, chainIdentifier: input.chain === 'solana' ? 'solana' : `eip155:${EVM_CHAIN_IDS[input.chain]}` },
    });
    return { notified: true, amountUsd };
  }

  /** The USDC an EVM transaction moved from the sender to the recipient (a Transfer log on the chain's USDC). */
  private async evmAmount(chainSlug: string, hash: string, from: string[], to: string[]): Promise<number> {
    const chainId = EVM_CHAIN_IDS[chainSlug];
    const client = chainId ? this.evmClients.get(chainId) : undefined;
    const usdc = chainId ? EVM_USDC_BY_CHAIN_ID[chainId] : undefined;
    if (!client || !usdc || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new BadRequestException('Unknown network or transaction');
    const receipt = await client.waitForTransactionReceipt({ hash: hash as Hex, timeout: 45_000 }).catch(() => null);
    if (!receipt || receipt.status !== 'success') throw new UnprocessableEntityException("The transfer isn't confirmed yet.");
    let raw = 0n;
    for (const log of receipt.logs) {
      if (!isAddressEqual(log.address, usdc.address as `0x${string}`)) continue;
      try {
        const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
        if (event.eventName !== 'Transfer') continue;
        const { from: f, to: t, value } = event.args;
        if (from.some((a) => isAddressEqual(a as `0x${string}`, f)) && to.some((a) => isAddressEqual(a as `0x${string}`, t))) raw += value;
      } catch {
        // not a Transfer
      }
    }
    if (raw === 0n) throw new ForbiddenException("This transaction didn't send USDC to that user.");
    return Number(raw) / 10 ** usdc.decimals;
  }

  /** The USDC a Solana transaction moved to the recipient, signed by one of the sender's wallets. */
  private async solanaAmount(signature: string, from: string[], to: string[]): Promise<number> {
    const connection = this.solana.relayerConnection;
    if (!connection || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new BadRequestException('Unknown transaction');
    let tx = null;
    for (let i = 0; i < 15 && !tx; i++) {
      tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (!tx) await new Promise((r) => setTimeout(r, 2_000));
    }
    if (!tx || tx.meta?.err) throw new UnprocessableEntityException("The transfer isn't confirmed yet.");
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const signers = keys.slice(0, tx.transaction.message.header.numRequiredSignatures).map((k) => k.toBase58());
    if (!signers.some((s) => from.includes(s))) throw new ForbiddenException("This transaction wasn't sent by you.");
    const balance = (list: { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] | null | undefined) =>
      (list ?? []).filter((b) => b.mint === SOLANA_USDC_MINT && b.owner && to.includes(b.owner)).reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
    const received = balance(tx.meta?.postTokenBalances) - balance(tx.meta?.preTokenBalances);
    if (received <= 0n) throw new ForbiddenException("This transaction didn't send USDC to that user.");
    return Number(received) / 1e6;
  }
}
