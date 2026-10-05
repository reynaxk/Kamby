import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEvmTransport } from '@kamby/chain-adapters';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, createWalletClient, erc20Abi, http, type Chain, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { getConfiguredChains, type Env } from '../config/env';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Per chain: how much native gas one top-up sends, and the balance below which a wallet gets
 * one. Base gas is ~$0.001–0.01 per tx, BNB ~$0.01–0.03 — one top-up covers the USDC approval,
 * the fee transfer and many trades.
 */
export const GAS_TOPUP_BY_CHAIN_ID: Record<number, { dripWei: bigint; minWei: bigint; name: string; symbol: string }> = {
  8453: { dripWei: 30_000_000_000_000n, minWei: 10_000_000_000_000n, name: 'Base', symbol: 'ETH' }, // 0.00003 / 0.00001 ETH
  56: { dripWei: 150_000_000_000_000n, minWei: 50_000_000_000_000n, name: 'BNB Chain', symbol: 'BNB' }, // 0.00015 / 0.00005 BNB
};
const ONE_PER_WALLET_SECONDS = 24 * 60 * 60;
const HAS_GAS_CACHE_SECONDS = 10 * 60;

/** Exported for tests. Whether a wallet should get a top-up — pure, no I/O. */
export function needsTopup(nativeWei: bigint, usdcRaw: bigint, usdcDecimals: number, minWei: bigint): boolean {
  const holdsAtLeastOneUsdc = usdcRaw >= 10n ** BigInt(usdcDecimals);
  return nativeWei < minWei && holdsAtLeastOneUsdc;
}

interface ChainClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  dripWei: bigint;
  minWei: bigint;
  /** Serializes this chain's top-ups so concurrent quotes never reuse a nonce. */
  queue: Promise<unknown>;
}

/**
 * Kamby pays the gas (product decision 2026-10-02: users only ever hold USDC). A wallet that
 * holds USDC but almost no ETH/BNB gets a few cents of native gas from Kamby's gas-tank wallet
 * (EVM_GAS_TOPUP_PRIVATE_KEY) the moment it asks for a quote — before its first approval,
 * which no meta-transaction relayer can cover. At most one top-up per wallet per day and
 * EVM_GAS_TOPUP_DAILY_CAP per chain per day, so the tank can't be drained. Never blocks or
 * fails a quote: any problem is logged and the quote goes ahead.
 */
@Injectable()
export class EvmGasTopupService {
  private readonly account: PrivateKeyAccount | null;
  private readonly dailyCap: number;
  private readonly clients = new Map<number, ChainClients>();

  constructor(
    config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('EvmGasTopupService');
    const key = config.get('EVM_GAS_TOPUP_PRIVATE_KEY', { infer: true });
    this.dailyCap = config.get('EVM_GAS_TOPUP_DAILY_CAP', { infer: true });
    this.account = key ? privateKeyToAccount(key as `0x${string}`) : null;
    if (!this.account) return;
    for (const chain of getConfiguredChains((k) => config.get(k, { infer: true }))) {
      const settings = GAS_TOPUP_BY_CHAIN_ID[chain.chainId];
      if (!settings) continue;
      // Built by hand like EvmRelayerWalletService's buildChain — importing viem/chains drags
      // in ox's webauthn types, which don't typecheck in this Node project.
      const chainDef: Chain = {
        id: chain.chainId,
        name: settings.name,
        nativeCurrency: { name: settings.symbol, symbol: settings.symbol, decimals: 18 },
        rpcUrls: { default: { http: [chain.rpcUrl] } },
      };
      this.clients.set(chain.chainId, {
        publicClient: createPublicClient({ chain: chainDef, transport: createEvmTransport(chain.rpcUrl, chain.rpcUrlFallback) }) as PublicClient,
        walletClient: createWalletClient({ account: this.account, chain: chainDef, transport: http(chain.rpcUrl) }),
        dripWei: settings.dripWei,
        minWei: settings.minWei,
        queue: Promise.resolve(),
      });
    }
    this.logger.info({ address: this.account.address, chains: [...this.clients.keys()] }, 'EVM gas top-up enabled');
  }

  /** The wallet's USDC on this chain, raw — or null when it can't be read (callers fail open). */
  async usdcBalance(chainId: number, wallet: string, usdcAddress: string): Promise<bigint | null> {
    const clients = this.clients.get(chainId);
    if (!clients) return null;
    try {
      return await clients.publicClient.readContract({ address: usdcAddress as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] });
    } catch (error) {
      this.logger.warn({ err: error, chainId }, 'USDC balance read failed — not blocking the quote');
      return null;
    }
  }

  async ensureGas(chainId: number, wallet: string, usdc: { address: string; decimals: number }): Promise<void> {
    const clients = this.clients.get(chainId);
    if (!clients) return;
    const walletKey = wallet.toLowerCase();
    try {
      if (await this.redis.get(`gas-ok:${chainId}:${walletKey}`)) return;
      const [nativeWei, usdcRaw] = await Promise.all([
        clients.publicClient.getBalance({ address: wallet as `0x${string}` }),
        clients.publicClient.readContract({ address: usdc.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] }),
      ]);
      if (!needsTopup(nativeWei, usdcRaw, usdc.decimals, clients.minWei)) {
        if (nativeWei >= clients.minWei) await this.redis.set(`gas-ok:${chainId}:${walletKey}`, '1', 'EX', HAS_GAS_CACHE_SECONDS);
        return;
      }
      const claimed = await this.redis.set(`gas-topup:${chainId}:${walletKey}`, '1', 'EX', ONE_PER_WALLET_SECONDS, 'NX');
      if (claimed !== 'OK') return; // already topped up in the last 24h
      const day = new Date().toISOString().slice(0, 10);
      const countKey = `gas-topup:count:${chainId}:${day}`;
      const count = await this.redis.incr(countKey);
      if (count === 1) await this.redis.expire(countKey, 2 * ONE_PER_WALLET_SECONDS);
      if (count > this.dailyCap) {
        this.logger.warn({ chainId, count, cap: this.dailyCap }, 'EVM gas top-up daily cap reached — not topping up');
        return;
      }

      const run = clients.queue.catch(() => undefined).then(async () => {
        const hash = await clients.walletClient.sendTransaction({
          account: this.account!,
          chain: clients.walletClient.chain,
          to: wallet as `0x${string}`,
          value: clients.dripWei,
        });
        await clients.publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
        this.logger.info({ chainId, wallet: walletKey, hash, valueWei: clients.dripWei.toString() }, 'EVM gas top-up sent');
      });
      clients.queue = run;
      await run;
    } catch (error) {
      this.logger.error({ err: error, chainId, wallet: walletKey }, 'EVM gas top-up failed — quote continues');
    }
  }
}
