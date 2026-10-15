import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenLaunch } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, type LaunchEvmTx, type LaunchProof } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, decodeEventLog, encodeFunctionData, erc20Abi, formatEther, http, isAddressEqual, parseAbi, parseEther, type Hex, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import { EvmGasTopupService } from '../../trading/evm-gas-topup.service';
import type { SwapRouter } from '../../trading/router/swap-router.interface';
import { SWAP_ROUTER } from '../../trading/router/swap-router.token';
import { evmChain } from './clanker.adapter';
import { buildEvmFunding, devBuyWei, verifyEvmTxs, type EvmLaunchChain } from './evm-launch';
import type { LaunchAdapter, LaunchMetadata, PreparedStep } from './launch-adapter';

const BNB_CHAIN_ID = 56;
export const FOURMEME_TOKEN_MANAGER_2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
export const FOURMEME_HELPER_3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
/** BNB kept for the create transaction's own gas. */
const CREATE_GAS_RESERVE_WEI = 1_000_000_000_000_000n; // 0.001 BNB
const TM2_ABI = parseAbi([
  'function createToken(bytes args, bytes signature) payable',
  'event TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)',
]);

/**
 * Four.meme on BNB Chain (Kamby's LaunchPad, 2026-10-15). Funding: see buildEvmFunding (fee + USDC →
 * BNB). Create: Four.meme's own API signs the launch (createArg + signature) — it has to be called
 * from the creator's browser through kambesh.com, Four.meme refuses Kamby's servers — and this
 * adapter turns that into TokenManager2.createToken with the first buy (`preSale`) as its BNB value,
 * simulated before it's handed out. The coin's address comes from the TokenCreate event.
 */
@Injectable()
export class FourMemeAdapter implements LaunchAdapter {
  readonly id = 'fourmeme' as const;
  readonly chainIdentifier = `eip155:${BNB_CHAIN_ID}`;
  private readonly client: PublicClient | null;
  private readonly feeRecipient: `0x${string}` | null;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(SWAP_ROUTER) private readonly router: SwapRouter,
    private readonly gas: EvmGasTopupService,
    private readonly logger: PinoLogger,
  ) {
    const chain = getConfiguredChains((key) => config.get(key, { infer: true })).find((c) => c.chainId === BNB_CHAIN_ID);
    this.client = chain ? (createPublicClient({ chain: evmChain(BNB_CHAIN_ID, 'BNB Chain', 'BNB', chain.rpcUrl), transport: http(chain.rpcUrl) }) as PublicClient) : null;
    this.feeRecipient = (config.get('PLATFORM_FEE_RECIPIENT_ADDRESS', { infer: true }) as `0x${string}` | undefined) ?? null;
    this.logger.setContext('FourMemeAdapter');
  }

  private chain(): EvmLaunchChain {
    const usdc = EVM_USDC_BY_CHAIN_ID[BNB_CHAIN_ID];
    if (!this.client || !this.feeRecipient || !usdc) throw new UnprocessableEntityException('Launching on BNB Chain is not available right now');
    return { chainId: BNB_CHAIN_ID, client: this.client, router: this.router, gas: this.gas, usdc, feeRecipient: this.feeRecipient, gasReserveWei: CREATE_GAS_RESERVE_WEI };
  }

  async buildFunding(launch: TokenLaunch, feeUsd: number): Promise<PreparedStep> {
    const { txs, networkCostUsd, swapRaw } = await buildEvmFunding(this.chain(), launch.walletAddress as `0x${string}`, Number(launch.devBuyUsd), feeUsd);
    return { evmTransactions: txs, networkCostUsd, fundUsdcRaw: swapRaw.toString() };
  }

  async submitFunding(launch: TokenLaunch, proof: LaunchProof): Promise<string> {
    await verifyEvmTxs(this.chain().client, launch.walletAddress, JSON.parse(launch.fundTx ?? '[]') as LaunchEvmTx[], proof);
    return proof.txHashes![proof.txHashes!.length - 1]!;
  }

  /** What the creator's browser puts in Four.meme's create request: the first buy, in BNB. */
  async createParams(launch: TokenLaunch): Promise<{ preSale: string }> {
    const wei = await devBuyWei(this.chain(), launch.walletAddress as `0x${string}`, Number(launch.devBuyUsd));
    return { preSale: formatEther(wei) };
  }

  async buildCreate(launch: TokenLaunch, _metadata: LaunchMetadata, input?: unknown): Promise<PreparedStep> {
    const { client } = this.chain();
    const { createArg, signature, preSale } = (input ?? {}) as { createArg?: unknown; signature?: unknown; preSale?: unknown };
    const hex = (v: unknown, max: number) => typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v) && v.length <= max;
    if (!hex(createArg, 20_000) || !hex(signature, 400) || typeof preSale !== 'string' || !/^\d+(\.\d{1,18})?$/.test(preSale)) {
      throw new BadRequestException("Four.meme didn't return a launch to sign — try again.");
    }
    const value = parseEther(preSale);
    const { preSale: allowed } = await this.createParams(launch);
    if (value > parseEther(allowed) + parseEther(allowed) / 50n) throw new BadRequestException('The first buy is bigger than this launch paid for.');
    const data = encodeFunctionData({ abi: TM2_ABI, functionName: 'createToken', args: [createArg as Hex, signature as Hex] });
    // Would it go through? A doomed create costs the creator gas for nothing.
    await client.call({ account: launch.walletAddress as `0x${string}`, to: FOURMEME_TOKEN_MANAGER_2, data, value }).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'four.meme createToken would revert');
      throw new UnprocessableEntityException('Four.meme would refuse this launch right now — nothing was sent. Try again.');
    });
    return { evmTransactions: [{ chainId: BNB_CHAIN_ID, to: FOURMEME_TOKEN_MANAGER_2, data, value: value.toString() }] };
  }

  async submitCreate(launch: TokenLaunch, proof: LaunchProof): Promise<{ signature: string; tokensRaw: string | null; tokenAddress?: string }> {
    const { client } = this.chain();
    await verifyEvmTxs(client, launch.walletAddress, JSON.parse(launch.createTx ?? '[]') as LaunchEvmTx[], proof);
    const hash = proof.txHashes![0]! as Hex;
    const receipt = await client.getTransactionReceipt({ hash });
    let token: `0x${string}` | null = null;
    for (const log of receipt.logs) {
      if (!isAddressEqual(log.address, FOURMEME_TOKEN_MANAGER_2)) continue;
      try {
        const event = decodeEventLog({ abi: TM2_ABI, data: log.data, topics: log.topics });
        if (event.eventName === 'TokenCreate' && isAddressEqual(event.args.creator, launch.walletAddress as `0x${string}`)) token = event.args.token;
      } catch {
        // another TokenManager2 event
      }
    }
    if (!token) throw new UnprocessableEntityException("Couldn't find the new coin in the transaction — check again in a minute.");
    const tokens = await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [launch.walletAddress as `0x${string}`] }).catch(() => null);
    return { signature: hash, tokensRaw: tokens === null ? null : tokens.toString(), tokenAddress: token };
  }
}
