import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, prisma, type TokenLaunch } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, LAUNCH_LIMITS, LAUNCHPADS, LaunchInputSchema, LaunchProofSchema, SOLANA_USDC_MINT, type Launch, type LaunchProof, type LaunchStep } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { FAMOUS_TICKERS } from '../market/lookalike-filter';
import { announceTradeInChat } from '../pulse/token-chat.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { LaunchAdapter, LaunchMetadata } from './adapters/launch-adapter';
import { ClankerAdapter, ClankerRobinhoodAdapter } from './adapters/clanker.adapter';
import { FourMemeAdapter } from './adapters/fourmeme.adapter';
import { PumpFunAdapter } from './adapters/pumpfun.adapter';

const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.subarray(0, 4).toString('ascii') === 'GIF8',
  'image/webp': (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

/** What a step handed out, as stored on the launch: Solana base64, or the EVM transactions as JSON. */
function storedTx(step: { transactionBase64?: string; evmTransactions?: unknown[] }): string {
  return step.transactionBase64 ?? JSON.stringify(step.evmTransactions ?? []);
}

function parseProof(raw: unknown): LaunchProof {
  const parsed = LaunchProofSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Send the signed transaction');
  return parsed.data;
}

function toDto(row: TokenLaunch, assetBase: string): Launch {
  return {
    id: row.id,
    launchpad: row.launchpad as Launch['launchpad'],
    chainIdentifier: row.chainIdentifier,
    name: row.name,
    symbol: row.symbol,
    imageUrl: row.imageId ? `${assetBase}/${row.imageId}` : null,
    devBuyUsd: Number(row.devBuyUsd),
    feeUsd: Number(row.feeUsd),
    networkCostUsd: Number(row.networkCostUsd),
    status: row.status as Launch['status'],
    tokenAddress: row.status === 'LIVE' ? row.tokenAddress : null,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Kamby's LaunchPad (2026-10-14): create a coin in four calls — prepare (store the metadata, build
 * the funding transaction), fund (relay it), create (build the create transaction), submit (send
 * it) — each launchpad's specifics in its adapter (adapters/). Every rule that matters is here,
 * whatever the app sends: the creator's own verified wallet, a real image Kamby stores, no
 * famous-coin tickers (impostors), one launch in progress at a time per user, and the exact
 * transactions this service built are the only ones it accepts back.
 */
@Injectable()
export class LaunchpadService {
  private readonly adapters: Map<string, LaunchAdapter>;
  private readonly feeUsd: number;
  readonly assetBase: string;

  constructor(
    config: ConfigService<Env, true>,
    pumpFun: PumpFunAdapter,
    clanker: ClankerAdapter,
    clankerRobinhood: ClankerRobinhoodAdapter,
    fourMeme: FourMemeAdapter,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.adapters = new Map<string, LaunchAdapter>([
      [pumpFun.id, pumpFun],
      [clanker.id, clanker],
      [clankerRobinhood.id, clankerRobinhood],
      [fourMeme.id, fourMeme],
    ]);
    this.feeUsd = config.get('LAUNCH_FEE_USD', { infer: true }) ?? LAUNCH_LIMITS.defaultFeeUsd;
    this.assetBase = (config.get('LAUNCH_ASSET_BASE_URL', { infer: true }) ?? 'https://kambesh.com/launch-assets').replace(/\/$/, '');
    this.logger.setContext('LaunchpadService');
  }

  config() {
    return {
      feeUsd: this.feeUsd,
      launchpads: LAUNCHPADS.map((l) => ({ ...l, live: l.live && this.adapters.has(l.id) })),
      devBuyPresetsUsd: LAUNCH_LIMITS.devBuyPresetsUsd,
      maxDevBuyUsd: LAUNCH_LIMITS.maxDevBuyUsd,
    };
  }

  async uploadImage(userId: string, file: { buffer: Buffer; mimetype: string; size: number }): Promise<{ imageId: string; imageUrl: string }> {
    const check = IMAGE_TYPES[file.mimetype];
    if (!check || !check(file.buffer)) throw new BadRequestException('Use a PNG, JPEG, GIF or WebP image.');
    if (file.size > LAUNCH_LIMITS.imageMaxBytes) throw new BadRequestException('The image is over 1 MB — use a smaller one.');
    const recent = await prisma.launchAsset.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent >= 20) throw new BadRequestException('Too many images in an hour — try again later.');
    const asset = await prisma.launchAsset.create({ data: { userId, contentType: file.mimetype, bytes: file.buffer }, select: { id: true } });
    return { imageId: asset.id, imageUrl: `${this.assetBase}/${asset.id}` };
  }

  async asset(id: string): Promise<{ contentType: string; bytes: Buffer }> {
    const asset = await prisma.launchAsset.findUnique({ where: { id }, select: { contentType: true, bytes: true } });
    if (!asset) throw new NotFoundException();
    return { contentType: asset.contentType, bytes: Buffer.from(asset.bytes) };
  }

  /** The coin's public metadata JSON (the on-chain `uri` points here, through kambesh.com). */
  async metadata(id: string): Promise<Record<string, unknown>> {
    const row = await prisma.tokenLaunch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return this.metadataOf(row);
  }

  private metadataOf(row: TokenLaunch): Record<string, unknown> & LaunchMetadata {
    return {
      name: row.name,
      symbol: row.symbol,
      description: row.description ?? '',
      image: row.imageId ? `${this.assetBase}/${row.imageId}` : '',
      imageUrl: row.imageId ? `${this.assetBase}/${row.imageId}` : '',
      metadataUri: `${this.assetBase}/${row.id}.json`,
      showName: true,
      createdOn: 'https://kambesh.com',
      ...(row.website ? { website: row.website } : {}),
      ...(row.twitter ? { twitter: row.twitter } : {}),
      ...(row.telegram ? { telegram: row.telegram } : {}),
    };
  }

  /** A coin created here, by its address — public; lets its page open the second it's live,
   *  before any market feed has picked it up. */
  async byToken(address: string): Promise<{ symbol: string; name: string; imageUrl: string | null; launchpad: string; chainIdentifier: string }> {
    const row = await prisma.tokenLaunch.findFirst({ where: { tokenAddress: address, status: 'LIVE' }, select: { symbol: true, name: true, imageId: true, launchpad: true, chainIdentifier: true } });
    if (!row) throw new NotFoundException();
    return { symbol: row.symbol, name: row.name, imageUrl: row.imageId ? `${this.assetBase}/${row.imageId}` : null, launchpad: row.launchpad, chainIdentifier: row.chainIdentifier };
  }

  async mine(userId: string): Promise<Launch[]> {
    const rows = await prisma.tokenLaunch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map((r) => toDto(r, this.assetBase));
  }

  /** Step 1 — store the launch and hand out the funding transaction. */
  async prepare(userId: string, raw: unknown): Promise<LaunchStep> {
    const parsed = LaunchInputSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
    const input = parsed.data;
    const adapter = this.adapters.get(input.launchpad);
    if (!adapter) throw new UnprocessableEntityException('This launchpad is coming soon.');
    if (FAMOUS_TICKERS.has(input.symbol.toLowerCase())) throw new BadRequestException(`$${input.symbol.toUpperCase()} is a famous coin's ticker — pick your own.`);

    const wallet = await prisma.wallet.findUnique({ where: { address: input.walletAddress } });
    const walletChain = adapter.chainIdentifier === 'solana' ? 'SOLANA' : 'EVM';
    if (!wallet || wallet.userId !== userId || wallet.verifiedAt === null || wallet.chain !== walletChain) {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }
    const image = await prisma.launchAsset.findUnique({ where: { id: input.imageId }, select: { userId: true } });
    if (!image || image.userId !== userId) throw new BadRequestException('Upload the coin logo first.');
    const busy = await prisma.tokenLaunch.findFirst({
      where: { userId, status: { in: ['FUNDED', 'CREATING'] }, updatedAt: { gte: new Date(Date.now() - 15 * 60_000) } },
      select: { id: true },
    });
    if (busy) throw new ConflictException('You have a launch in progress — finish it first.');

    let row = await prisma.tokenLaunch.create({
      data: {
        userId,
        launchpad: input.launchpad,
        chainIdentifier: adapter.chainIdentifier,
        walletAddress: input.walletAddress,
        name: input.name,
        symbol: input.symbol.toUpperCase(),
        description: input.description || null,
        website: input.website ?? null,
        twitter: input.twitter ?? null,
        telegram: input.telegram ?? null,
        imageId: input.imageId,
        devBuyUsd: input.devBuyUsd,
        feeUsd: this.feeUsd,
      },
    });
    const step = await adapter.buildFunding(row, this.feeUsd);
    row = await prisma.tokenLaunch.update({
      where: { id: row.id },
      data: { fundTx: storedTx(step), fundUsdcRaw: step.fundUsdcRaw ?? null, networkCostUsd: step.networkCostUsd ?? 0, metadataUri: `${this.assetBase}/${row.id}.json` },
    });
    return { launch: toDto(row, this.assetBase), transactionBase64: step.transactionBase64, evmTransactions: step.evmTransactions };
  }

  /** Step 2 — the creator signed the funding transaction; relay it and wait for it. */
  async fund(userId: string, id: string, rawProof: unknown): Promise<Launch> {
    const proof = parseProof(rawProof);
    const row = await this.own(userId, id);
    if (row.status !== 'PREPARED') return toDto(row, this.assetBase);
    const lock = await this.lock(id);
    try {
      const signature = await this.adapter(row).submitFunding(row, proof);
      const updated = await prisma.tokenLaunch.update({ where: { id }, data: { status: 'FUNDED', fundSignature: signature } });
      return toDto(updated, this.assetBase);
    } catch (error) {
      await this.fail(id, error);
      throw error;
    } finally {
      await lock();
    }
  }

  /** Between steps 2 and 3, for launchpads the creator's browser must ask itself (Four.meme). */
  async createParams(userId: string, id: string): Promise<Record<string, string>> {
    const row = await this.own(userId, id);
    if (row.status !== 'FUNDED' && row.status !== 'CREATING') throw new ConflictException('This launch is not ready to create.');
    const adapter = this.adapter(row);
    return adapter.createParams ? adapter.createParams(row) : {};
  }

  /** Step 3 — build the create transaction (with the first buy) for the creator to sign. */
  async create(userId: string, id: string, input?: unknown): Promise<LaunchStep> {
    const row = await this.own(userId, id);
    if (row.status !== 'FUNDED' && row.status !== 'CREATING') throw new ConflictException('This launch is not ready to create.');
    const step = await this.adapter(row).buildCreate(row, this.metadataOf(row), input);
    const updated = await prisma.tokenLaunch.update({ where: { id }, data: { status: 'CREATING', createTx: storedTx(step), tokenAddress: step.tokenAddress ?? null } });
    return { launch: toDto(updated, this.assetBase), transactionBase64: step.transactionBase64, evmTransactions: step.evmTransactions };
  }

  /** Step 4 — send the signed create; on success the coin is live (and its first buy is on the
   *  creator's books like any Kamby buy, so it shows in their coins with its PnL). */
  async submit(userId: string, id: string, rawProof: unknown): Promise<Launch> {
    const proof = parseProof(rawProof);
    const row = await this.own(userId, id);
    if (row.status === 'LIVE') return toDto(row, this.assetBase);
    if (row.status !== 'CREATING') throw new ConflictException('This launch is not ready to submit.');
    const lock = await this.lock(id);
    try {
      const { signature, tokensRaw, tokenAddress } = await this.adapter(row).submitCreate(row, proof);
      const updated = await prisma.tokenLaunch.update({
        where: { id },
        data: { status: 'LIVE', createSignature: signature, liveAt: new Date(), failureReason: null, ...(tokenAddress ? { tokenAddress } : {}) },
      });
      await this.recordFirstBuy(updated, signature, tokensRaw);
      return toDto(updated, this.assetBase);
    } catch (error) {
      await prisma.tokenLaunch.update({ where: { id }, data: { failureReason: error instanceof Error ? error.message.slice(0, 300) : 'failed' } }).catch(() => undefined);
      throw error;
    } finally {
      await lock();
    }
  }

  private async recordFirstBuy(row: TokenLaunch, signature: string, tokensRaw: string | null): Promise<void> {
    if (row.chainIdentifier !== 'solana') return this.recordEvmLaunch(row, signature, tokensRaw);
    const devBuyRaw = Math.round(Number(row.devBuyUsd) * 1e6).toString();
    if (row.chainIdentifier !== 'solana' || !row.tokenAddress || !tokensRaw || tokensRaw === '0' || devBuyRaw === '0') return;
    try {
      const now = new Date();
      const quote = await prisma.solanaTradeQuote.create({
        data: {
          userId: row.userId,
          walletAddress: row.walletAddress,
          side: 'BUY',
          inputMint: SOLANA_USDC_MINT,
          outputMint: row.tokenAddress,
          inputAmount: devBuyRaw,
          expectedOutputAmount: tokensRaw,
          minOutputAmount: tokensRaw,
          slippageBps: 0,
          platformFeeBps: 0,
          platformFeeAmount: '0',
          unsignedTx: { base64: '', totalPaidRaw: devBuyRaw, launchId: row.id },
          expiresAt: now,
        },
      });
      const trade = await prisma.solanaTradeTransaction.create({
        data: {
          userId: row.userId,
          walletAddress: row.walletAddress,
          quoteId: quote.id,
          signature,
          side: 'BUY',
          inputMint: SOLANA_USDC_MINT,
          outputMint: row.tokenAddress,
          inputAmount: devBuyRaw,
          expectedOutputAmount: tokensRaw,
          platformFeeAmount: '0',
          status: 'CONFIRMED',
          confirmedAt: now,
          sponsoredByRelayer: false,
        },
      });
      void announceTradeInChat(this.redis, { id: trade.id, userId: row.userId, chainIdentifier: 'solana', tokenAddress: row.tokenAddress, side: 'BUY', usd: Number(row.devBuyUsd) });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        this.logger.error({ err: error, launchId: row.id }, 'launch is live but its first buy could not be recorded');
      }
    }
  }

  /**
   * An EVM coin is only tradable in Kamby once it's a tracked market (its page, quotes, chart):
   * listed here the moment it's live — priced through the aggregators like Kamby's other
   * `agg:` markets (the workers keep its price fresh) — then the first buy goes on the creator's
   * books like any Kamby buy.
   */
  private async recordEvmLaunch(row: TokenLaunch, txHash: string, tokensRaw: string | null): Promise<void> {
    const chainId = Number(row.chainIdentifier.split(':')[1]);
    const usdcInfo = EVM_USDC_BY_CHAIN_ID[chainId];
    if (!row.tokenAddress || !usdcInfo) return;
    try {
      const chain = await prisma.chain.findUnique({ where: { identifier: row.chainIdentifier } });
      const usdc = chain ? await prisma.token.findFirst({ where: { chainId: chain.id, contractAddress: { equals: usdcInfo.address, mode: 'insensitive' } } }) : null;
      if (!chain || !usdc) return;
      const token = await prisma.token.upsert({
        where: { chainId_contractAddress: { chainId: chain.id, contractAddress: row.tokenAddress } },
        update: {},
        create: { chainId: chain.id, contractAddress: row.tokenAddress, symbol: row.symbol, name: row.name, decimals: 18, logoUrl: row.imageId ? `${this.assetBase}/${row.imageId}` : null },
      });
      const market =
        (await prisma.tokenMarket.findFirst({ where: { chainId: chain.id, tokenId: token.id } })) ??
        (await prisma.tokenMarket.create({ data: { chainId: chain.id, tokenId: token.id, quoteTokenId: usdc.id, dex: row.launchpad === 'fourmeme' ? 'fourmeme' : `agg:${row.launchpad}`, pairAddress: row.tokenAddress.toLowerCase() } }));
      const devBuyRaw = Math.round(Number(row.devBuyUsd) * 10 ** usdcInfo.decimals).toString();
      if (!tokensRaw || tokensRaw === '0' || devBuyRaw === '0') return;
      const now = new Date();
      const quote = await prisma.tradeQuote.create({
        data: {
          userId: row.userId,
          walletAddress: row.walletAddress,
          chainId,
          side: 'BUY',
          tokenMarketId: market.id,
          inputToken: usdcInfo.address,
          outputToken: row.tokenAddress,
          inputAmount: devBuyRaw,
          expectedOutputAmount: tokensRaw,
          minOutputAmount: tokensRaw,
          slippageBps: 0,
          platformFeeBps: 0,
          platformFeeAmount: '0',
          provider: row.launchpad,
          unsignedTx: { launchId: row.id },
          expiresAt: now,
        },
      });
      const trade = await prisma.tradeTransaction.create({
        data: {
          userId: row.userId,
          walletAddress: row.walletAddress,
          quoteId: quote.id,
          chainId,
          txHash,
          tokenMarketId: market.id,
          side: 'BUY',
          inputToken: usdcInfo.address,
          outputToken: row.tokenAddress,
          inputAmount: devBuyRaw,
          expectedOutputAmount: tokensRaw,
          platformFeeAmount: '0',
          status: 'CONFIRMED',
          confirmedAt: now,
        },
      });
      void announceTradeInChat(this.redis, { id: trade.id, userId: row.userId, chainIdentifier: row.chainIdentifier, tokenAddress: row.tokenAddress, side: 'BUY', usd: Number(row.devBuyUsd) });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        this.logger.error({ err: error, launchId: row.id }, 'EVM launch is live but its market or first buy could not be recorded');
      }
    }
  }

  private async own(userId: string, id: string): Promise<TokenLaunch> {
    const row = await prisma.tokenLaunch.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Launch not found');
    return row;
  }

  private adapter(row: TokenLaunch): LaunchAdapter {
    const adapter = this.adapters.get(row.launchpad);
    if (!adapter) throw new UnprocessableEntityException('This launchpad is not available.');
    return adapter;
  }

  /** One step at a time per launch (a double tap can't relay or send twice). */
  private async lock(id: string): Promise<() => Promise<void>> {
    const key = `kamby:launch:lock:${id}`;
    const ok = await this.redis.set(key, '1', 'EX', 90, 'NX').catch(() => 'OK');
    if (ok !== 'OK') throw new ConflictException('This step is already running — wait a moment.');
    return async () => {
      await this.redis.del(key).catch(() => undefined);
    };
  }

  private async fail(id: string, error: unknown): Promise<void> {
    await prisma.tokenLaunch
      .update({ where: { id }, data: { failureReason: error instanceof Error ? error.message.slice(0, 300) : 'failed' } })
      .catch(() => undefined);
  }
}
