import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEvmTransport } from '@kamby/chain-adapters';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import type { SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

const VELORA_BASE_URL = 'https://api.paraswap.io';
const FETCH_TIMEOUT_MS = 3000;
/** Chains Velora (ParaSwap) routes that Kamby trades on. */
const VELORA_CHAIN_IDS = new Set([8453, 56, 42161, 1]);
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const erc20Abi = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

/** A Velora price, before its transaction is built (building only happens for the winner). */
export interface VeloraPrice {
  buyAmountRaw: string;
  priceImpactBps: number | null;
  /** Velora's own route, handed back unchanged to build the transaction. */
  priceRoute: Record<string, unknown>;
  spender: string;
}

/**
 * Velora (ParaSwap) — a second EVM aggregator next to KyberSwap (2026-10-09, "every part top
 * tier"). Each Base/BNB quote asks both; MultiChainSwapRouter takes Velora only when it returns
 * clearly more, and uses it as the fallback whenever KyberSwap has no route or is down (Odos was
 * tried first and its public API was returning Cloudflare 530/1033 errors). Two steps: `/prices`
 * for every quote, `/transactions` only for the winner. Only asked for trades with no aggregator
 * fee — Kamby's fee is a separate USDC transfer.
 */
@Injectable()
export class VeloraRouter {
  private readonly chainClients: Map<number, PublicClient>;
  private readonly decimals = new Map<string, number>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const chains = getConfiguredChains((key) => config.get(key, { infer: true }));
    this.chainClients = new Map(chains.map((c) => [c.chainId, createPublicClient({ transport: createEvmTransport(c.rpcUrl, c.rpcUrlFallback) })]));
    this.logger.setContext('VeloraRouter');
  }

  supports(chainId: number): boolean {
    return VELORA_CHAIN_IDS.has(chainId) && this.chainClients.has(chainId);
  }

  async price(request: SwapRouterQuoteRequest): Promise<VeloraPrice | null> {
    try {
      const [srcDecimals, destDecimals] = await Promise.all([this.tokenDecimals(request.chainId, request.sellToken), this.tokenDecimals(request.chainId, request.buyToken)]);
      if (srcDecimals === null || destDecimals === null) return null;
      const params = new URLSearchParams({
        srcToken: request.sellToken,
        destToken: request.buyToken,
        amount: request.sellAmountRaw,
        srcDecimals: String(srcDecimals),
        destDecimals: String(destDecimals),
        side: 'SELL',
        network: String(request.chainId),
        version: '6.2',
        userAddress: request.taker,
      });
      const response = await fetch(`${VELORA_BASE_URL}/prices?${params.toString()}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'Velora prices rejected the request');
        return null;
      }
      const body = (await response.json()) as { priceRoute?: Record<string, unknown> & { destAmount?: string; tokenTransferProxy?: string; srcUSD?: string; destUSD?: string } };
      const route = body.priceRoute;
      if (!route?.destAmount || !/^\d+$/.test(route.destAmount) || route.destAmount === '0' || !route.tokenTransferProxy) return null;
      const src = Number(route.srcUSD);
      const dest = Number(route.destUSD);
      const impact = src > 0 && dest > 0 ? Math.max(0, Math.round((1 - dest / src) * 10_000)) : null;
      return { buyAmountRaw: route.destAmount, priceImpactBps: impact, priceRoute: route, spender: route.tokenTransferProxy };
    } catch (error) {
      this.logger.warn({ err: error }, 'Velora prices unreachable');
      return null;
    }
  }

  async build(request: SwapRouterQuoteRequest, price: VeloraPrice): Promise<SwapRouterQuote | null> {
    try {
      const response = await fetch(`${VELORA_BASE_URL}/transactions/${request.chainId}?ignoreChecks=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          srcToken: request.sellToken,
          destToken: request.buyToken,
          srcAmount: request.sellAmountRaw,
          priceRoute: price.priceRoute,
          userAddress: request.taker,
          slippage: Math.round(request.slippageBps),
          partner: 'kamby',
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'Velora transactions rejected the request');
        return null;
      }
      const tx = (await response.json()) as { to?: string; data?: string; value?: string; gas?: string };
      if (!tx.to || !tx.data) return null;
      const requiresApproval = await this.needsApproval(request, price.spender);
      if (requiresApproval === null) return null;
      return {
        provider: 'velora',
        providerQuoteId: null,
        buyAmountRaw: price.buyAmountRaw,
        sellAmountRaw: '',
        minBuyAmountRaw: ((BigInt(price.buyAmountRaw) * (10000n - BigInt(Math.round(request.slippageBps)))) / 10000n).toString(),
        priceImpactBps: price.priceImpactBps,
        feeAmountRaw: null,
        requiresApproval,
        approvalSpender: requiresApproval ? price.spender : null,
        unsignedTx: { to: tx.to, data: tx.data, value: tx.value ?? '0', gas: tx.gas && Number(tx.gas) > 0 ? tx.gas : null, maxFeePerGas: null, maxPriorityFeePerGas: null },
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'Velora transactions unreachable');
      return null;
    }
  }

  /** Allowance for this route's spender — null when unreadable, never guessed. */
  async needsApproval(request: SwapRouterQuoteRequest, spender: string): Promise<boolean | null> {
    if (request.sellToken.toLowerCase() === NATIVE) return false;
    const client = this.chainClients.get(request.chainId);
    if (!client) return null;
    try {
      const allowance = await client.readContract({ address: request.sellToken as `0x${string}`, abi: erc20Abi, functionName: 'allowance', args: [request.taker as `0x${string}`, spender as `0x${string}`] });
      return allowance < BigInt(request.sellAmountRaw);
    } catch (error) {
      this.logger.warn({ err: error }, 'Velora allowance check unreachable');
      return null;
    }
  }

  private async tokenDecimals(chainId: number, token: string): Promise<number | null> {
    if (token.toLowerCase() === NATIVE) return 18;
    const key = `${chainId}:${token.toLowerCase()}`;
    const cached = this.decimals.get(key);
    if (cached !== undefined) return cached;
    const client = this.chainClients.get(chainId);
    if (!client) return null;
    try {
      const value = Number(await client.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: 'decimals' }));
      this.decimals.set(key, value);
      return value;
    } catch {
      return null;
    }
  }
}
