import { ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenLaunch } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, type LaunchEvmTx, type LaunchProof } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, defineChain, encodeFunctionData, erc20Abi, http, isAddressEqual, type Hex, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import { buildErc20TransferTx } from '../../trading/erc20-transfer';
import { EvmGasTopupService } from '../../trading/evm-gas-topup.service';
import type { SwapRouter } from '../../trading/router/swap-router.interface';
import { SWAP_ROUTER } from '../../trading/router/swap-router.token';
import type { LaunchAdapter, LaunchMetadata, PreparedStep } from './launch-adapter';

const BASE_CHAIN_ID = 8453;
const NATIVE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
/** ETH kept for the create transaction's own gas (a Clanker deploy is ~6M gas; Base gas is cheap). */
const DEPLOY_GAS_RESERVE_WEI = 200_000_000_000_000n; // 0.0002 ETH
/** The smallest swap the funding step does — it also buys the deploy's gas. */
const MIN_SWAP_USD = 1;
const SWAP_BUFFER = 1.02;
/** Kamby's share of the coin's trading rewards (owner, 2026-10-14: 10%, the creator keeps 90%). */
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

/**
 * Clanker on Base (Kamby's LaunchPad, 2026-10-14). Funding, sent from the creator's own wallet (Kamby's
 * gas tank tops up their gas first, as for trades): Kamby's fixed fee as a USDC transfer, then a
 * KyberSwap swap of USDC for the ETH the first buy and the deploy need. Create: Clanker's v4
 * deployToken (built with their SDK), the first buy inside it, rewards split 90% creator / 10% Kamby.
 * Every hash that comes back is checked against exactly what was handed out.
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
    // Base, defined here rather than imported from viem/chains (that entry point drags browser-only types into this Node build).
    const baseChain = defineChain({ id: BASE_CHAIN_ID, name: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [chain?.rpcUrl ?? 'https://mainnet.base.org'] } } });
    this.client = chain ? (createPublicClient({ chain: baseChain, transport: http(chain.rpcUrl) }) as PublicClient) : null;
    this.feeRecipient = (config.get('PLATFORM_FEE_RECIPIENT_ADDRESS', { infer: true }) as `0x${string}` | undefined) ?? null;
    this.logger.setContext('ClankerAdapter');
  }

  private ready(): { client: PublicClient; feeRecipient: `0x${string}`; usdc: { address: string; decimals: number } } {
    const usdc = EVM_USDC_BY_CHAIN_ID[BASE_CHAIN_ID];
    if (!this.client || !this.feeRecipient || !usdc) throw new UnprocessableEntityException('Launching on Base is not available right now');
    return { client: this.client, feeRecipient: this.feeRecipient, usdc };
  }

  /** Wei one US dollar buys right now (KyberSwap's own price for $10 of USDC → ETH). */
  private async weiPerUsd(wallet: string): Promise<number> {
    const { usdc } = this.ready();
    const quote = await this.router.getQuote({ chainId: BASE_CHAIN_ID, sellToken: usdc.address, buyToken: NATIVE_ETH, sellAmountRaw: String(10 * 10 ** usdc.decimals), taker: wallet, slippageBps: 100, feeRecipient: null, feeBps: 0 });
    const wei = quote ? Number(quote.buyAmountRaw) / 10 : NaN;
    if (!(wei > 0)) throw new UnprocessableEntityException("Couldn't price ETH right now — try again in a moment");
    return wei;
  }

  async buildFunding(launch: TokenLaunch, feeUsd: number): Promise<PreparedStep> {
    const { client, feeRecipient, usdc } = this.ready();
    const wallet = launch.walletAddress as `0x${string}`;
    if ((await this.gas.ensureGas(BASE_CHAIN_ID, wallet, usdc)) === 'stranded') {
      throw new UnprocessableEntityException('Launching on Base is getting ready — try again in a few minutes.');
    }
    const perUsd = await this.weiPerUsd(wallet);
    const balance = await client.getBalance({ address: wallet });
    const neededWei = BigInt(Math.round(Number(launch.devBuyUsd) * perUsd)) + DEPLOY_GAS_RESERVE_WEI;
    const shortUsd = neededWei > balance ? Number(neededWei - balance) / perUsd : 0;
    const swapUsd = Math.max(MIN_SWAP_USD, shortUsd * SWAP_BUFFER);
    const swapRaw = BigInt(Math.ceil(swapUsd * 10 ** usdc.decimals));

    const quote = await this.router.getQuote({ chainId: BASE_CHAIN_ID, sellToken: usdc.address, buyToken: NATIVE_ETH, sellAmountRaw: swapRaw.toString(), taker: wallet, slippageBps: 100, feeRecipient: null, feeBps: 0 });
    if (!quote) throw new UnprocessableEntityException("Couldn't get a USDC → ETH price right now — try again in a moment");

    const fee = buildErc20TransferTx(usdc.address, feeRecipient, BigInt(Math.round(feeUsd * 10 ** usdc.decimals)));
    const txs: LaunchEvmTx[] = [{ chainId: BASE_CHAIN_ID, to: fee.to, data: fee.data, value: '0' }];
    if (quote.requiresApproval && quote.approvalSpender) {
      const approve = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [quote.approvalSpender as `0x${string}`, swapRaw] });
      txs.push({ chainId: BASE_CHAIN_ID, to: usdc.address, data: approve, value: '0' });
    }
    txs.push({ chainId: BASE_CHAIN_ID, to: quote.unsignedTx.to, data: quote.unsignedTx.data, value: String(quote.unsignedTx.value ?? '0') });
    return { evmTransactions: txs, networkCostUsd: Number(DEPLOY_GAS_RESERVE_WEI) / perUsd, fundUsdcRaw: swapRaw.toString() };
  }

  async submitFunding(launch: TokenLaunch, proof: LaunchProof): Promise<string> {
    const expected = JSON.parse(launch.fundTx ?? '[]') as LaunchEvmTx[];
    await this.verifySent(launch.walletAddress, expected, proof);
    return proof.txHashes![proof.txHashes!.length - 1]!;
  }

  async buildCreate(launch: TokenLaunch, metadata: LaunchMetadata): Promise<PreparedStep> {
    const { client, feeRecipient } = this.ready();
    const wallet = launch.walletAddress as `0x${string}`;
    const balance = await client.getBalance({ address: wallet });
    const spendable = balance - DEPLOY_GAS_RESERVE_WEI;
    const target = Number(launch.devBuyUsd) > 0 ? BigInt(Math.round(Number(launch.devBuyUsd) * (await this.weiPerUsd(wallet)))) : 0n;
    if (target > 0n && spendable <= 0n) throw new UnprocessableEntityException('Not enough ETH for the launch yet — the swap may still be landing. Try again in a few seconds.');
    const devBuyWei = target > spendable ? spendable : target;

    const socials = [
      metadata.twitter && { platform: 'x', url: metadata.twitter },
      metadata.telegram && { platform: 'telegram', url: metadata.telegram },
      metadata.website && { platform: 'website', url: metadata.website },
    ].filter(Boolean);
    const { Clanker } = await this.loadSdk();
    const deploy = await new Clanker({ publicClient: client }).getDeployTransaction({
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.imageUrl,
      chainId: BASE_CHAIN_ID,
      tokenAdmin: wallet,
      metadata: { description: metadata.description || undefined, socialMediaUrls: socials },
      context: { interface: 'Kamby', platform: 'kambesh.com' },
      ...(devBuyWei > 0n ? { devBuy: { ethAmount: Number(devBuyWei) / 1e18, recipient: wallet } } : {}),
      rewards: {
        recipients: [
          { admin: wallet, recipient: wallet, bps: 10_000 - KAMBY_REWARD_BPS, token: 'Both' },
          { admin: feeRecipient, recipient: feeRecipient, bps: KAMBY_REWARD_BPS, token: 'Both' },
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
    const { client } = this.ready();
    const expected = JSON.parse(launch.createTx ?? '[]') as LaunchEvmTx[];
    await this.verifySent(launch.walletAddress, expected, proof);
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

  /** Every hash: sent by the creator, to the address, with the data and value handed out — and succeeded. */
  private async verifySent(walletAddress: string, expected: LaunchEvmTx[], proof: LaunchProof): Promise<void> {
    const { client } = this.ready();
    const hashes = proof.txHashes ?? [];
    if (expected.length === 0 || hashes.length !== expected.length) throw new UnprocessableEntityException('Send every transaction of this step');
    for (let i = 0; i < expected.length; i++) {
      const want = expected[i]!;
      const hash = hashes[i] as Hex;
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
      if (!receipt) throw new UnprocessableEntityException("A transaction hasn't confirmed yet — check again in a minute.");
      const tx = await client.getTransaction({ hash });
      const matches =
        isAddressEqual(tx.from, walletAddress as `0x${string}`) &&
        tx.to !== null &&
        isAddressEqual(tx.to, want.to as `0x${string}`) &&
        tx.input.toLowerCase() === want.data.toLowerCase() &&
        tx.value === BigInt(want.value);
      if (!matches) throw new ForbiddenException("A transaction doesn't match the launch you prepared");
      if (receipt.status !== 'success') throw new UnprocessableEntityException('A transaction failed on-chain — nothing more was spent.');
    }
  }
}
