import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, MIN_TRADE_MESSAGE, MIN_TRADE_USD, resolveTierFeeBps, type LaunchEvmTx } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { createPublicClient, decodeEventLog, encodeFunctionData, erc20Abi, http, isAddressEqual, parseAbi, type Hex, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import { evmChain } from '../../launchpad/adapters/clanker.adapter';
import { NATIVE_COIN, verifyEvmTxs } from '../../launchpad/adapters/evm-launch';
import { announceTradeInChat } from '../../pulse/token-chat.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { buildErc20TransferTx } from '../erc20-transfer';
import { EvmGasTopupService } from '../evm-gas-topup.service';
import type { SwapRouter } from '../router/swap-router.interface';
import { SWAP_ROUTER } from '../router/swap-router.token';

const BNB_CHAIN_ID = 56;
export const TOKEN_MANAGER_2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
export const HELPER_3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
/** BNB kept back for gas when sizing the curve buy and the swap back. */
const GAS_RESERVE_WEI = 500_000_000_000_000n; // 0.0005 BNB
/** The curve buy accepts up to this much less than estimated (price moves between steps). */
const CURVE_SLIPPAGE_BPS = 500n;
const SWAP_SLIPPAGE_BPS = 100;
const STATE_TTL_SECONDS = 30 * 60;

const HELPER_ABI = parseAbi([
  'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
  'function tryBuy(address token, uint256 amount, uint256 funds) view returns (address tokenManager, address quote, uint256 estimatedAmount, uint256 estimatedCost, uint256 estimatedFee, uint256 amountMsgValue, uint256 amountApproval, uint256 amountFunds)',
  'function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)',
]);
const TM2_ABI = parseAbi([
  'function buyTokenAMAP(address token, uint256 funds, uint256 minAmount) payable',
  'function sellToken(address token, uint256 amount)',
  'event TokenPurchase(address token, address account, uint256 price, uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)',
  'event TokenSale(address token, address account, uint256 price, uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)',
]);

export interface CurveState {
  graduated: boolean;
  priceUsd: number | null;
  marketCapUsd: number | null;
  /** How far along its curve the coin is, 0–100 (graduates to PancakeSwap at 100). */
  progressPct: number;
}

/** A curve trade in flight, between its steps (Redis, 30 minutes). */
interface PendingCurveTrade {
  id: string;
  userId: string;
  wallet: `0x${string}`;
  token: `0x${string}`;
  side: 'BUY' | 'SELL';
  stage: 'swap-in' | 'curve-buy' | 'curve-sell' | 'swap-out';
  txs: LaunchEvmTx[];
  amountUsd?: number;
  feeRaw?: string;
  tokensRaw?: string;
  usdcOutRaw?: string;
  /** The BNB this trade's own swap or sale brings in — the most the next step may spend. */
  bnbRaw?: string;
}

export interface CurveStep {
  id: string;
  /** Sent from the wallet in order; `null` when the trade is done. */
  transactions: LaunchEvmTx[] | null;
  /** Estimated coins (buy) or USDC (sell), raw. */
  estimateRaw?: string;
  done?: { tokensRaw?: string; usdcRaw?: string };
}

/**
 * Trading Four.meme coins still on their bonding curve (2026-10-15) — no aggregator routes them, so
 * Kamby does it itself, in USDC like every trade: a buy is Kamby's fee, a USDC → BNB swap, then the
 * curve buy (sized to the BNB that actually arrived); a sell is the curve sell, then BNB → USDC and
 * Kamby's fee. Each step is sent from the user's wallet and checked (sender, target, data, value)
 * before the next is built; the finished trade goes on their books like any Kamby trade. Once a
 * coin graduates (liquidityAdded) it trades on PancakeSwap through the normal path.
 */
@Injectable()
export class FourMemeCurveService {
  private readonly client: PublicClient | null;
  private readonly feeRecipient: `0x${string}` | null;
  private bnbUsd: { at: number; value: number } | null = null;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(SWAP_ROUTER) private readonly router: SwapRouter,
    private readonly gas: EvmGasTopupService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    const chain = getConfiguredChains((key) => config.get(key, { infer: true })).find((c) => c.chainId === BNB_CHAIN_ID);
    this.client = chain ? (createPublicClient({ chain: evmChain(BNB_CHAIN_ID, 'BNB Chain', 'BNB', chain.rpcUrl), transport: http(chain.rpcUrl) }) as PublicClient) : null;
    this.feeRecipient = (config.get('PLATFORM_FEE_RECIPIENT_ADDRESS', { infer: true }) as `0x${string}` | undefined) ?? null;
    this.logger.setContext('FourMemeCurveService');
  }

  private ready() {
    const usdc = EVM_USDC_BY_CHAIN_ID[BNB_CHAIN_ID];
    if (!this.client || !this.feeRecipient || !usdc) throw new UnprocessableEntityException('Trading on BNB Chain is not available right now');
    return { client: this.client, feeRecipient: this.feeRecipient, usdc };
  }

  /** BNB's USD price (the router's price for $10 of USDC), kept 30s. */
  private async bnbPriceUsd(wallet: string): Promise<number> {
    if (this.bnbUsd && Date.now() - this.bnbUsd.at < 30_000) return this.bnbUsd.value;
    const { usdc } = this.ready();
    const quote = await this.router.getQuote({ chainId: BNB_CHAIN_ID, sellToken: usdc.address, buyToken: NATIVE_COIN, sellAmountRaw: (10n * 10n ** BigInt(usdc.decimals)).toString(), taker: wallet, slippageBps: 100, feeRecipient: null, feeBps: 0 });
    const bnb = quote ? Number(quote.buyAmountRaw) / 1e18 : 0;
    if (!(bnb > 0)) throw new UnprocessableEntityException("Couldn't price BNB right now — try again in a moment");
    this.bnbUsd = { at: Date.now(), value: 10 / bnb };
    return this.bnbUsd.value;
  }

  /** Where the coin is on its curve — and whether it's graduated to PancakeSwap. */
  async state(token: string): Promise<CurveState> {
    const { client } = this.ready();
    const info = await client.readContract({ address: HELPER_3, abi: HELPER_ABI, functionName: 'getTokenInfo', args: [token as `0x${string}`] });
    const [, , , lastPrice, , , , , , funds, maxFunds, liquidityAdded] = info;
    const bnbUsd = await this.bnbPriceUsd(token).catch(() => null);
    const priceUsd = bnbUsd !== null ? (Number(lastPrice) / 1e18) * bnbUsd : null;
    const state: CurveState = {
      graduated: liquidityAdded,
      priceUsd,
      marketCapUsd: priceUsd !== null ? priceUsd * 1e9 : null,
      progressPct: maxFunds > 0n ? Math.min(100, Number((funds * 10_000n) / maxFunds) / 100) : 0,
    };
    // The coin's market row carries the live price (positions, lists) between the workers' refreshes.
    if (priceUsd !== null) {
      await prisma.tokenMarket
        .updateMany({ where: { dex: 'fourmeme', pairAddress: token.toLowerCase() }, data: { priceUsd, marketCapUsd: state.marketCapUsd, lastPriceUpdateAt: new Date() } })
        .catch(() => undefined);
    }
    return state;
  }

  private async checkTrader(userId: string, wallet: string, token: string): Promise<void> {
    const row = await prisma.wallet.findUnique({ where: { address: wallet } });
    if (!row || row.userId !== userId || row.verifiedAt === null || row.chain !== 'EVM') throw new ForbiddenException('This wallet is not verified as belonging to your account');
    const market = await prisma.tokenMarket.findFirst({ where: { dex: 'fourmeme', pairAddress: token.toLowerCase() }, select: { id: true } });
    if (!market) throw new NotFoundException('This coin is not on Four.meme in Kamby');
    if ((await this.state(token)).graduated) throw new ConflictCurve();
  }

  /** Buy, step 1: Kamby's fee, then USDC → BNB (with its approval when needed). */
  async startBuy(userId: string, wallet: `0x${string}`, token: `0x${string}`, amountUsd: number): Promise<CurveStep> {
    const { usdc, feeRecipient } = this.ready();
    if (!(amountUsd >= MIN_TRADE_USD)) throw new BadRequestException(MIN_TRADE_MESSAGE);
    await this.checkTrader(userId, wallet, token);
    if ((await this.gas.ensureGas(BNB_CHAIN_ID, wallet, usdc)) === 'stranded') throw new UnprocessableEntityException('Trading on BNB Chain is getting ready — try again in a few minutes.');
    const unit = 10 ** usdc.decimals;
    const feeRaw = BigInt(Math.round(amountUsd * (resolveTierFeeBps(amountUsd) / 10_000) * unit));
    const swapRaw = BigInt(Math.round(amountUsd * unit)) - feeRaw;
    const quote = await this.router.getQuote({ chainId: BNB_CHAIN_ID, sellToken: usdc.address, buyToken: NATIVE_COIN, sellAmountRaw: swapRaw.toString(), taker: wallet, slippageBps: SWAP_SLIPPAGE_BPS, feeRecipient: null, feeBps: 0 });
    if (!quote) throw new UnprocessableEntityException("Couldn't get a price right now — try again in a moment");
    const fee = buildErc20TransferTx(usdc.address, feeRecipient, feeRaw);
    const txs: LaunchEvmTx[] = [{ chainId: BNB_CHAIN_ID, to: fee.to, data: fee.data, value: '0' }];
    if (quote.requiresApproval && quote.approvalSpender) {
      txs.push({ chainId: BNB_CHAIN_ID, to: usdc.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [quote.approvalSpender as `0x${string}`, swapRaw] }), value: '0' });
    }
    txs.push({ chainId: BNB_CHAIN_ID, to: quote.unsignedTx.to, data: quote.unsignedTx.data, value: String(quote.unsignedTx.value ?? '0') });
    const estimate = await this.tryBuy(token, BigInt(quote.buyAmountRaw)).catch(() => null);
    const pending: PendingCurveTrade = { id: randomUUID(), userId, wallet, token, side: 'BUY', stage: 'swap-in', txs, amountUsd, feeRaw: feeRaw.toString(), bnbRaw: quote.minBuyAmountRaw };
    await this.save(pending);
    return { id: pending.id, transactions: txs, estimateRaw: estimate?.estimatedAmount.toString() };
  }

  /** Sell, step 1: the curve sell (with the coin's approval when needed). */
  async startSell(userId: string, wallet: `0x${string}`, token: `0x${string}`, amountRaw: bigint): Promise<CurveStep> {
    const { client } = this.ready();
    if (!(amountRaw > 0n)) throw new BadRequestException('Enter an amount to sell');
    await this.checkTrader(userId, wallet, token);
    const { usdc } = this.ready();
    if ((await this.gas.ensureGas(BNB_CHAIN_ID, wallet, usdc)) === 'stranded') throw new UnprocessableEntityException('Trading on BNB Chain is getting ready — try again in a few minutes.');
    // No $2 minimum on a sell (2026-10-18): a position under $2 must still be sellable.
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [wallet, TOKEN_MANAGER_2] });
    const txs: LaunchEvmTx[] = [];
    if (allowance < amountRaw) txs.push({ chainId: BNB_CHAIN_ID, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [TOKEN_MANAGER_2, amountRaw] }), value: '0' });
    txs.push({ chainId: BNB_CHAIN_ID, to: TOKEN_MANAGER_2, data: encodeFunctionData({ abi: TM2_ABI, functionName: 'sellToken', args: [token, amountRaw] }), value: '0' });
    const pending: PendingCurveTrade = { id: randomUUID(), userId, wallet, token, side: 'SELL', stage: 'curve-sell', txs, tokensRaw: amountRaw.toString() };
    await this.save(pending);
    return { id: pending.id, transactions: txs };
  }

  /** The next step, once the wallet sent the current one (its hashes, in order). */
  async next(userId: string, id: string, txHashes: string[]): Promise<CurveStep> {
    const pending = await this.load(id);
    if (pending.userId !== userId) throw new ForbiddenException('This trade is not yours');
    const { client, usdc, feeRecipient } = this.ready();
    await verifyEvmTxs(client, pending.wallet, pending.txs, { txHashes });
    const last = txHashes[txHashes.length - 1] as Hex;

    if (pending.stage === 'swap-in') {
      // The BNB that actually arrived, less gas, buys on the curve.
      const balance = await client.getBalance({ address: pending.wallet });
      const spendable = balance - GAS_RESERVE_WEI;
      const ownSwap = BigInt(pending.bnbRaw ?? '0');
      const funds = spendable < ownSwap ? spendable : ownSwap;
      if (funds <= 0n) throw new UnprocessableEntityException('The BNB hasn\'t arrived yet — try again in a few seconds.');
      const estimate = await this.tryBuy(pending.token, funds);
      const minAmount = (estimate.estimatedAmount * (10_000n - CURVE_SLIPPAGE_BPS)) / 10_000n;
      const tx: LaunchEvmTx = { chainId: BNB_CHAIN_ID, to: TOKEN_MANAGER_2, data: encodeFunctionData({ abi: TM2_ABI, functionName: 'buyTokenAMAP', args: [pending.token, estimate.amountFunds, minAmount] }), value: estimate.amountMsgValue.toString() };
      await this.save({ ...pending, stage: 'curve-buy', txs: [tx] });
      return { id, transactions: [tx], estimateRaw: estimate.estimatedAmount.toString() };
    }

    if (pending.stage === 'curve-buy') {
      const tokensRaw = (await this.eventArgs(last, 'TokenPurchase', pending.wallet)).amount;
      await this.record(pending, last, tokensRaw, null);
      await this.redis.del(this.key(id)).catch(() => undefined);
      return { id, transactions: null, done: { tokensRaw: tokensRaw.toString() } };
    }

    if (pending.stage === 'curve-sell') {
      // Swap what the sale paid (less gas) back to USDC, then Kamby's fee on that.
      const sale = await this.eventArgs(last, 'TokenSale', pending.wallet);
      const proceeds = sale.cost - sale.fee;
      const balance = await client.getBalance({ address: pending.wallet });
      const spendable = balance - GAS_RESERVE_WEI;
      const swapWei = spendable < proceeds ? spendable : proceeds;
      if (swapWei <= 0n) throw new UnprocessableEntityException('The sale\'s BNB hasn\'t arrived yet — try again in a few seconds.');
      const quote = await this.router.getQuote({ chainId: BNB_CHAIN_ID, sellToken: NATIVE_COIN, buyToken: usdc.address, sellAmountRaw: swapWei.toString(), taker: pending.wallet, slippageBps: SWAP_SLIPPAGE_BPS, feeRecipient: null, feeBps: 0 });
      if (!quote) throw new UnprocessableEntityException("Couldn't get a price for BNB → USDC right now — try again in a moment");
      const usdOut = Number(quote.minBuyAmountRaw) / 10 ** usdc.decimals;
      const feeRaw = BigInt(Math.round(usdOut * (resolveTierFeeBps(usdOut) / 10_000) * 10 ** usdc.decimals));
      const fee = buildErc20TransferTx(usdc.address, feeRecipient, feeRaw);
      const txs: LaunchEvmTx[] = [
        { chainId: BNB_CHAIN_ID, to: quote.unsignedTx.to, data: quote.unsignedTx.data, value: String(quote.unsignedTx.value ?? swapWei.toString()) },
        { chainId: BNB_CHAIN_ID, to: fee.to, data: fee.data, value: '0' },
      ];
      await this.save({ ...pending, stage: 'swap-out', txs, feeRaw: feeRaw.toString(), usdcOutRaw: (BigInt(quote.minBuyAmountRaw) - feeRaw).toString() });
      return { id, transactions: txs, estimateRaw: (BigInt(quote.minBuyAmountRaw) - feeRaw).toString() };
    }

    // swap-out: done
    await this.record(pending, last, BigInt(pending.tokensRaw ?? '0'), BigInt(pending.usdcOutRaw ?? '0'));
    await this.redis.del(this.key(id)).catch(() => undefined);
    return { id, transactions: null, done: { usdcRaw: pending.usdcOutRaw } };
  }

  private async tryBuy(token: `0x${string}`, funds: bigint) {
    const { client } = this.ready();
    const [, , estimatedAmount, , , amountMsgValue, , amountFunds] = await client.readContract({ address: HELPER_3, abi: HELPER_ABI, functionName: 'tryBuy', args: [token, 0n, funds] });
    return { estimatedAmount, amountMsgValue, amountFunds };
  }

  /** The coins a curve buy got (TokenPurchase), or that a sale sold (TokenSale), for this wallet. */
  private async eventArgs(hash: Hex, name: 'TokenPurchase' | 'TokenSale', wallet: `0x${string}`): Promise<{ amount: bigint; cost: bigint; fee: bigint }> {
    const { client } = this.ready();
    const receipt = await client.getTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      if (!isAddressEqual(log.address, TOKEN_MANAGER_2)) continue;
      try {
        const event = decodeEventLog({ abi: TM2_ABI, data: log.data, topics: log.topics });
        if (event.eventName === name && isAddressEqual(event.args.account, wallet)) return { amount: event.args.amount, cost: event.args.cost, fee: event.args.fee };
      } catch {
        // another TokenManager2 event
      }
    }
    throw new UnprocessableEntityException("Couldn't read the trade from the transaction — check your coins in a minute.");
  }

  /** On the user's books like any Kamby trade (positions, PnL, leaderboard, the coin's chat). */
  private async record(pending: PendingCurveTrade, txHash: string, tokensRaw: bigint, usdcOutRaw: bigint | null): Promise<void> {
    const { usdc } = this.ready();
    const market = await prisma.tokenMarket.findFirst({ where: { dex: 'fourmeme', pairAddress: pending.token.toLowerCase() } });
    if (!market) return;
    const buy = pending.side === 'BUY';
    const usdcInRaw = buy ? BigInt(Math.round((pending.amountUsd ?? 0) * 10 ** usdc.decimals)).toString() : null;
    const now = new Date();
    try {
      const quote = await prisma.tradeQuote.create({
        data: {
          userId: pending.userId,
          walletAddress: pending.wallet,
          chainId: BNB_CHAIN_ID,
          side: pending.side,
          tokenMarketId: market.id,
          inputToken: buy ? usdc.address : pending.token,
          outputToken: buy ? pending.token : usdc.address,
          inputAmount: buy ? usdcInRaw! : tokensRaw.toString(),
          expectedOutputAmount: buy ? tokensRaw.toString() : usdcOutRaw!.toString(),
          minOutputAmount: buy ? tokensRaw.toString() : usdcOutRaw!.toString(),
          slippageBps: Number(CURVE_SLIPPAGE_BPS),
          platformFeeBps: 0,
          platformFeeAmount: pending.feeRaw ?? '0',
          provider: 'fourmeme-curve',
          unsignedTx: { curveTradeId: pending.id },
          expiresAt: now,
        },
      });
      const trade = await prisma.tradeTransaction.create({
        data: {
          userId: pending.userId,
          walletAddress: pending.wallet,
          quoteId: quote.id,
          chainId: BNB_CHAIN_ID,
          txHash,
          tokenMarketId: market.id,
          side: pending.side,
          inputToken: quote.inputToken,
          outputToken: quote.outputToken,
          inputAmount: quote.inputAmount,
          expectedOutputAmount: quote.expectedOutputAmount,
          platformFeeAmount: pending.feeRaw ?? '0',
          status: 'CONFIRMED',
          confirmedAt: now,
        },
      });
      const usd = buy ? (pending.amountUsd ?? 0) : Number(usdcOutRaw) / 10 ** usdc.decimals;
      void announceTradeInChat(this.redis, { id: trade.id, userId: pending.userId, chainIdentifier: `eip155:${BNB_CHAIN_ID}`, tokenAddress: pending.token, side: pending.side, usd });
    } catch (error) {
      this.logger.error({ err: error, curveTradeId: pending.id }, 'curve trade went through but could not be recorded');
    }
  }

  private key(id: string): string {
    return `kamby:curve-trade:${id}`;
  }

  private async save(pending: PendingCurveTrade): Promise<void> {
    await this.redis.set(this.key(pending.id), JSON.stringify(pending), 'EX', STATE_TTL_SECONDS);
  }

  private async load(id: string): Promise<PendingCurveTrade> {
    const raw = await this.redis.get(this.key(id)).catch(() => null);
    if (!raw) throw new NotFoundException('This trade expired — start it again.');
    return JSON.parse(raw) as PendingCurveTrade;
  }
}

class ConflictCurve extends UnprocessableEntityException {
  constructor() {
    super('This coin has graduated to PancakeSwap — it trades like any other coin now. Refresh the page.');
  }
}
