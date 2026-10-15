import { prisma } from '@kamby/db';
import type { PinoLogger } from 'nestjs-pino';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbi } from 'viem';
import { FourMemeCurveService, TOKEN_MANAGER_2 } from './fourmeme-curve.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    wallet: { findUnique: jest.fn() },
    tokenMarket: { findFirst: jest.fn(), updateMany: jest.fn() },
    tradeQuote: { create: jest.fn() },
    tradeTransaction: { create: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));
jest.mock('../../pulse/token-chat.service', () => ({ announceTradeInChat: jest.fn() }));

const mockedPrisma = jest.mocked(prisma, { shallow: true });
const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const TREASURY = '0x3333333333333333333333333333333333333333';
const ROUTER = '0x4444444444444444444444444444444444444444';
const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
const hash = (n: number) => `0x${String(n).padStart(64, '0')}`;
const TM2_EVENTS = parseAbi(['event TokenSale(address token, address account, uint256 price, uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)']);

describe('FourMemeCurveService', () => {
  let service: FourMemeCurveService;
  let client: { readContract: jest.Mock; getBalance: jest.Mock; waitForTransactionReceipt: jest.Mock; getTransaction: jest.Mock; getTransactionReceipt: jest.Mock };
  let router: { getQuote: jest.Mock };
  let store: Map<string, string>;
  let graduated: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    graduated = false;
    store = new Map();
    const redis = { set: jest.fn(async (k: string, v: string) => void store.set(k, v)), get: jest.fn(async (k: string) => store.get(k) ?? null), del: jest.fn(async () => 1) };
    router = {
      getQuote: jest.fn(async (req: { sellToken: string; sellAmountRaw: string }) =>
        req.sellToken.startsWith('0xEeee')
          ? { buyAmountRaw: '590000000000000000000', minBuyAmountRaw: '584000000000000000000', requiresApproval: false, approvalSpender: null, unsignedTx: { to: ROUTER, data: '0xbbbb', value: req.sellAmountRaw } }
          : { buyAmountRaw: '16000000000000000', minBuyAmountRaw: '15800000000000000', requiresApproval: false, approvalSpender: null, unsignedTx: { to: ROUTER, data: '0xaaaa', value: '0' } },
      ),
    };
    const config = { get: (k: string) => ({ CHAINS: 'bnb', CHAIN_BNB_ID: 56, CHAIN_BNB_RPC_URL: 'https://rpc', CHAIN_BNB_USDC_ADDRESS: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', PLATFORM_FEE_RECIPIENT_ADDRESS: TREASURY })[k] };
    service = new FourMemeCurveService(config as never, router as never, { ensureGas: jest.fn().mockResolvedValue('ok') } as never, redis as never, logger);
    client = {
      readContract: jest.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'getTokenInfo') return [2n, TOKEN_MANAGER_2, '0x0000000000000000000000000000000000000000', 1_000_000_000n, 100n, 0n, 0n, 0n, 0n, 5n * 10n ** 18n, 24n * 10n ** 18n, graduated];
        if (functionName === 'tryBuy') return [TOKEN_MANAGER_2, '0x0', 1_000_000n * 10n ** 18n, 0n, 0n, 15_000_000_000_000_000n, 0n, 15_000_000_000_000_000n];
        if (functionName === 'trySell') return [TOKEN_MANAGER_2, '0x0', 20_000_000_000_000_000n, 0n];
        if (functionName === 'allowance') return 0n;
        return 0n;
      }),
      getBalance: jest.fn().mockResolvedValue(10n ** 18n), // 1 BNB already in the wallet
      waitForTransactionReceipt: jest.fn().mockResolvedValue({ status: 'success' }),
      getTransaction: jest.fn(),
      getTransactionReceipt: jest.fn(),
    };
    (service as unknown as { client: unknown }).client = client;
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: 'u1', verifiedAt: new Date(), chain: 'EVM' });
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue({ id: 'm1' });
    (mockedPrisma.tokenMarket.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  /** The wallet "sent" exactly the transactions handed out. */
  function sent(txs: { to: string; data: string; value: string }[]) {
    client.getTransaction.mockImplementation(async ({ hash: h }: { hash: string }) => {
      const t = txs[Number(BigInt(h)) - 1]!;
      return { from: WALLET, to: t.to, input: t.data, value: BigInt(t.value) };
    });
    return txs.map((_, i) => hash(i + 1));
  }

  it("buy: Kamby's tier fee to the treasury first, then the USDC → BNB swap", async () => {
    const step = await service.startBuy('u1', WALLET, TOKEN, 10);
    const [fee, swap] = step.transactions!;
    expect(decodeFunctionData({ abi: erc20Abi, data: fee!.data as `0x${string}` }).args).toEqual([TREASURY, 200_000_000_000_000_000n]); // 2% of $10, 18-decimal USDC
    expect(swap).toMatchObject({ to: ROUTER, data: '0xaaaa' });
  });

  it("buy: the curve buy spends only this trade's own BNB, never the rest of the wallet", async () => {
    const step = await service.startBuy('u1', WALLET, TOKEN, 10);
    await service.next('u1', step.id, sent(step.transactions!));
    const tryBuy = client.readContract.mock.calls.filter(([c]) => c.functionName === 'tryBuy').pop()![0];
    expect(tryBuy.args[2]).toBe(15_800_000_000_000_000n); // the swap's minimum out, not the 1 BNB balance
  });

  it('sell: swaps back only what the sale paid, then takes the fee in USDC', async () => {
    const step = await service.startSell('u1', WALLET, TOKEN, 1_000n * 10n ** 18n);
    expect(step.transactions!.map((t) => t.to)).toEqual([TOKEN, TOKEN_MANAGER_2]); // approve, then sell
    const hashes = sent(step.transactions!);
    const data = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [TOKEN, WALLET, 1n, 1_000n * 10n ** 18n, 21_000_000_000_000_000n, 1_000_000_000_000_000n, 0n, 0n],
    );
    client.getTransactionReceipt.mockResolvedValue({ logs: [{ address: TOKEN_MANAGER_2, topics: encodeEventTopics({ abi: TM2_EVENTS, eventName: 'TokenSale' }), data }] });
    const next = await service.next('u1', step.id, hashes);
    const [swap, fee] = next.transactions!;
    expect(BigInt(swap!.value)).toBe(20_000_000_000_000_000n); // the sale's 0.021 − 0.001 fee, not the wallet's 1 BNB
    expect(decodeFunctionData({ abi: erc20Abi, data: fee!.data as `0x${string}` }).args?.[0]).toBe(TREASURY);
  });

  it('refuses a coin that has graduated (it trades on PancakeSwap then)', async () => {
    graduated = true;
    await expect(service.startBuy('u1', WALLET, TOKEN, 10)).rejects.toThrow(/graduated/);
  });

  it("refuses a step whose transactions aren't the ones handed out", async () => {
    const step = await service.startBuy('u1', WALLET, TOKEN, 10);
    client.getTransaction.mockResolvedValue({ from: WALLET, to: TREASURY, input: '0xdead', value: 0n });
    await expect(service.next('u1', step.id, [hash(1), hash(2)])).rejects.toThrow(/doesn't match/);
  });
});
