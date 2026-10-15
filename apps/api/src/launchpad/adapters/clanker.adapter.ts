import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenLaunch } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, type LaunchEvmTx, type LaunchProof } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, defineChain, encodeFunctionData, erc20Abi, http, type Hex, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import { EvmGasTopupService } from '../../trading/evm-gas-topup.service';
import type { SwapRouter } from '../../trading/router/swap-router.interface';
import { SWAP_ROUTER } from '../../trading/router/swap-router.token';
import { buildEvmFunding, devBuyWei, verifyEvmTxs, type EvmLaunchChain } from './evm-launch';
import type { LaunchAdapter, LaunchMetadata, PreparedStep } from './launch-adapter';

const BASE_CHAIN_ID = 8453;
/** ETH kept for the create transaction's own gas (a Clanker deploy is ~6M gas; Base gas is cheap). */
const DEPLOY_GAS_RESERVE_WEI = 200_000_000_000_000n; // 0.0002 ETH
/** Kamby's share of the coin's trading rewards (owner, 2026-10-15: 10%, the creator keeps 90%). */
const KAMBY_REWARD_BPS = 1_000;

interface ClankerDeployTx {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  expectedAddress?: `0x${string}`;
}
interface ClankerV4 {
  Clanker: new (config: { publicClient: PublicClient }) => { getDeployTransaction(token: Record<string, unknown>): Promise<ClankerDeployTx> };
}
/** clanker-sdk ships as ES modules only; this API compiles to CommonJS, so it's loaded with a real
 *  `import()` (which TypeScript would otherwise rewrite to `require`). */
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<ClankerV4>;

/** viem's chain object for an EVM chain, defined here rather than imported from viem/chains (that
 *  entry point drags browser-only types into this Node build). */
export function evmChain(id: number, name: string, symbol: string, rpcUrl: string) {
  return defineChain({ id, name, nativeCurrency: { name: symbol, symbol, decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
}

/**
 * Clanker on Base (Kamby's LaunchPad, 2026-10-15). Funding: see buildEvmFunding (fee + USDC → ETH).
 * Create: Clanker's v4 deployToken (built with their SDK), the first buy inside it, rewards split
 * 90% creator / 10% Kamby. Every hash that comes back is checked against exactly what was handed out.
 */
@Injectable()
export class ClankerAdapter implements LaunchAdapter {
  readonly id = 'clanker' as const;
  readonly chainIdentifier = `eip155:${BASE_CHAIN_ID}`;
  private readonly client: PublicClient | null;
  private readonly feeRecipient: `0x${string}` | null;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(SWAP_ROUTER) private readonly router: SwapRouter,
    private readonly gas: EvmGasTopupService,
    private readonly logger: PinoLogger,
  ) {
    const chain = getConfiguredChains((key) => config.get(key, { infer: true })).find((c) => c.chainId === BASE_CHAIN_ID);
    this.client = chain ? (createPublicClient({ chain: evmChain(BASE_CHAIN_ID, 'Base', 'ETH', chain.rpcUrl), transport: http(chain.rpcUrl) }) as PublicClient) : null;
    this.feeRecipient = (config.get('PLATFORM_FEE_RECIPIENT_ADDRESS', { infer: true }) as `0x${string}` | undefined) ?? null;
    this.logger.setContext('ClankerAdapter');
  }

  private chain(): EvmLaunchChain {
    const usdc = EVM_USDC_BY_CHAIN_ID[BASE_CHAIN_ID];
    if (!this.client || !this.feeRecipient || !usdc) throw new UnprocessableEntityException('Launching on Base is not available right now');
    return { chainId: BASE_CHAIN_ID, client: this.client, router: this.router, gas: this.gas, usdc, feeRecipient: this.feeRecipient, gasReserveWei: DEPLOY_GAS_RESERVE_WEI };
  }

  async buildFunding(launch: TokenLaunch, feeUsd: number): Promise<PreparedStep> {
    const { txs, networkCostUsd, swapRaw } = await buildEvmFunding(this.chain(), launch.walletAddress as `0x${string}`, Number(launch.devBuyUsd), feeUsd);
    return { evmTransactions: txs, networkCostUsd, fundUsdcRaw: swapRaw.toString() };
  }

  async submitFunding(launch: TokenLaunch, proof: LaunchProof): Promise<string> {
    await verifyEvmTxs(this.chain().client, launch.walletAddress, JSON.parse(launch.fundTx ?? '[]') as LaunchEvmTx[], proof);
    return proof.txHashes![proof.txHashes!.length - 1]!;
  }

  async buildCreate(launch: TokenLaunch, metadata: LaunchMetadata): Promise<PreparedStep> {
    const chain = this.chain();
    const wallet = launch.walletAddress as `0x${string}`;
    const buyWei = await devBuyWei(chain, wallet, Number(launch.devBuyUsd));
    const socials = [
      metadata.twitter && { platform: 'x', url: metadata.twitter },
      metadata.telegram && { platform: 'telegram', url: metadata.telegram },
      metadata.website && { platform: 'website', url: metadata.website },
    ].filter(Boolean);
    const { Clanker } = await this.loadSdk();
    const deploy = await new Clanker({ publicClient: chain.client }).getDeployTransaction({
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.imageUrl,
      chainId: BASE_CHAIN_ID,
      tokenAdmin: wallet,
      metadata: { description: metadata.description || undefined, socialMediaUrls: socials },
      context: { interface: 'Kamby', platform: 'kambesh.com' },
      ...(buyWei > 0n ? { devBuy: { ethAmount: Number(buyWei) / 1e18, recipient: wallet } } : {}),
      rewards: {
        recipients: [
          { admin: wallet, recipient: wallet, bps: 10_000 - KAMBY_REWARD_BPS, token: 'Both' },
          { admin: chain.feeRecipient, recipient: chain.feeRecipient, bps: KAMBY_REWARD_BPS, token: 'Both' },
        ],
      },
    });
    if (!deploy.expectedAddress) throw new UnprocessableEntityException("Couldn't prepare the coin's address — try again");
    const data = (encodeFunctionData as unknown as (p: { abi: unknown; functionName: string; args: unknown }) => Hex)({ abi: deploy.abi, functionName: deploy.functionName, args: deploy.args });
    return {
      evmTransactions: [{ chainId: BASE_CHAIN_ID, to: deploy.address, data, value: String(deploy.value ?? 0n) }],
      tokenAddress: deploy.expectedAddress,
    };
  }

  async submitCreate(launch: TokenLaunch, proof: LaunchProof): Promise<{ signature: string; tokensRaw: string | null }> {
    const { client } = this.chain();
    await verifyEvmTxs(client, launch.walletAddress, JSON.parse(launch.createTx ?? '[]') as LaunchEvmTx[], proof);
    const token = launch.tokenAddress as `0x${string}`;
    const code = await client.getCode({ address: token });
    if (!code || code === '0x') throw new UnprocessableEntityException("The coin isn't on-chain yet — check again in a minute.");
    const tokens = await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [launch.walletAddress as `0x${string}`] }).catch(() => null);
    return { signature: proof.txHashes![0]!, tokensRaw: tokens === null ? null : tokens.toString() };
  }

  /** The Clanker SDK (separate so tests can stand in for it). */
  protected loadSdk(): Promise<ClankerV4> {
    return importEsm('clanker-sdk/v4');
  }
}
