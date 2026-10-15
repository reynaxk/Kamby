import type { TokenLaunch } from '@kamby/db';
import type { PinoLogger } from 'nestjs-pino';
import { decodeFunctionData, erc20Abi } from 'viem';
import { ClankerAdapter } from './clanker.adapter';

const WALLET = '0x1111111111111111111111111111111111111111';
const TREASURY = '0x2222222222222222222222222222222222222222';
const SPENDER = '0x3333333333333333333333333333333333333333';
const ROUTER = '0x4444444444444444444444444444444444444444';
const FACTORY = '0x5555555555555555555555555555555555555555';
const TOKEN = '0x6666666666666666666666666666666666666666';
const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
const launch = { walletAddress: WALLET, devBuyUsd: 10 } as unknown as TokenLaunch;
const metadata = { name: 'Kamby Cat', symbol: 'KCAT', description: 'meow', imageUrl: 'https://kambesh.com/launch-assets/i', metadataUri: 'x', twitter: 'https://x.com/kcat' };
const hash = (n: number) => `0x${String(n).padStart(64, '0')}`;

describe('ClankerAdapter', () => {
  let adapter: ClankerAdapter;
  let client: { getBalance: jest.Mock; waitForTransactionReceipt: jest.Mock; getTransaction: jest.Mock; getCode: jest.Mock; readContract: jest.Mock };
  let gas: { ensureGas: jest.Mock };
  let deployedWith: Record<string, unknown> | null;

  beforeEach(() => {
    deployedWith = null;
    const config = {
      get: (key: string) =>
        ({ CHAINS: 'base', CHAIN_BASE_ID: 8453, CHAIN_BASE_RPC_URL: 'https://rpc', CHAIN_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', PLATFORM_FEE_RECIPIENT_ADDRESS: TREASURY })[key],
    };
    const router = {
      getQuote: jest.fn().mockResolvedValue({ buyAmountRaw: '4000000000000000', requiresApproval: true, approvalSpender: SPENDER, unsignedTx: { to: ROUTER, data: '0xabcd', value: '0' } }),
    };
    gas = { ensureGas: jest.fn().mockResolvedValue('ok') };
    adapter = new ClankerAdapter(config as never, router as never, gas as never, logger);
    client = { getBalance: jest.fn().mockResolvedValue(0n), waitForTransactionReceipt: jest.fn(), getTransaction: jest.fn(), getCode: jest.fn(), readContract: jest.fn() };
    (adapter as unknown as { client: unknown }).client = client;
    jest.spyOn(adapter as unknown as { loadSdk: () => Promise<unknown> }, 'loadSdk').mockResolvedValue({
      Clanker: class {
        async getDeployTransaction(token: Record<string, unknown>) {
          deployedWith = token;
          return { address: FACTORY, abi: erc20Abi, functionName: 'transfer', args: [TREASURY, 1n], value: 1n, expectedAddress: TOKEN };
        }
      },
    });
  });

  it('funding: Kamby fee to the treasury, then the approval and the swap', async () => {
    const step = await adapter.buildFunding(launch, 5);
    const [fee, approve, swap] = step.evmTransactions!;
    expect(decodeFunctionData({ abi: erc20Abi, data: fee!.data as `0x${string}` }).args).toEqual([TREASURY, 5_000_000n]);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data as `0x${string}` }).args?.[0]).toBe(SPENDER);
    expect(swap).toMatchObject({ to: ROUTER, data: '0xabcd' });
  });

  it("refuses to fund while the chain's gas tank can't cover the wallet", async () => {
    gas.ensureGas.mockResolvedValue('stranded');
    await expect(adapter.buildFunding(launch, 5)).rejects.toThrow(/getting ready/);
  });

  it('create: the first buy goes to the creator, rewards 90% creator / 10% Kamby', async () => {
    client.getBalance.mockResolvedValue(5_000_000_000_000_000n);
    const step = await adapter.buildCreate(launch, metadata);
    expect(step.tokenAddress).toBe(TOKEN);
    expect(deployedWith).toMatchObject({ tokenAdmin: WALLET, devBuy: { recipient: WALLET }, context: { interface: 'Kamby' } });
    expect((deployedWith!.rewards as { recipients: { recipient: string; bps: number }[] }).recipients).toEqual([
      expect.objectContaining({ recipient: WALLET, bps: 9000 }),
      expect.objectContaining({ recipient: TREASURY, bps: 1000 }),
    ]);
  });

  it('accepts a sent step only if every transaction is exactly the one handed out', async () => {
    const step = await adapter.buildFunding(launch, 5);
    const row = { ...launch, fundTx: JSON.stringify(step.evmTransactions) } as unknown as TokenLaunch;
    const txs = step.evmTransactions!;
    client.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    client.getTransaction.mockImplementation(async ({ hash: h }: { hash: string }) => {
      const i = Number(BigInt(h)) - 1;
      return { from: WALLET, to: txs[i]!.to, input: txs[i]!.data, value: BigInt(txs[i]!.value) };
    });
    await expect(adapter.submitFunding(row, { txHashes: [hash(1), hash(2), hash(3)] })).resolves.toBe(hash(3));

    client.getTransaction.mockImplementation(async () => ({ from: WALLET, to: TREASURY, input: '0xdead', value: 0n }));
    await expect(adapter.submitFunding(row, { txHashes: [hash(1), hash(2), hash(3)] })).rejects.toThrow(/doesn't match/);
    await expect(adapter.submitFunding(row, { txHashes: [hash(1)] })).rejects.toThrow(/every transaction/);
  });
});
