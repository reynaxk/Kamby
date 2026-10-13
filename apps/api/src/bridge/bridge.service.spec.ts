import { prisma } from '@kamby/db';
import type { PinoLogger } from 'nestjs-pino';
import { BridgeService, feeUsd, toEvmSteps } from './bridge.service';
import type { RelayClient, RelayQuote } from './relay-client';

jest.mock('@kamby/db', () => ({ prisma: { wallet: { findMany: jest.fn() } } }));

const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn() } as unknown as PinoLogger;
const config = { get: jest.fn().mockReturnValue(undefined) } as never;
const USER = '0x1234567890AbcdEF1234567890aBcdef12345678';
const SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function relayQuote(over: Partial<RelayQuote> = {}): RelayQuote {
  return {
    requestId: `0x${'a'.repeat(64)}`,
    steps: [
      { id: 'approve', kind: 'transaction', items: [{ status: 'incomplete', data: { from: USER, to: BASE_USDC, data: '0x095ea7b3', value: '0', chainId: 8453, gas: '73112' } }] },
      { id: 'deposit', kind: 'transaction', items: [{ status: 'incomplete', data: { from: USER, to: '0x4cd00e387622c35bddb9b4c962c136462338bc31', data: '0xe8017952', value: '0', chainId: 8453 } }] },
    ],
    fees: { gas: { amountUsd: '0.0012' }, relayer: { amountUsd: '0.0216' }, app: { amountUsd: '0' } },
    details: { currencyIn: { amount: '5021600' }, currencyOut: { amount: '5000000' }, timeEstimate: 1 },
    ...over,
  };
}

describe('BridgeService', () => {
  let relay: { quote: jest.Mock; status: jest.Mock };
  let gasTopup: { ensureGas: jest.Mock };
  let service: BridgeService;

  beforeEach(() => {
    jest.clearAllMocks();
    relay = { quote: jest.fn().mockResolvedValue(relayQuote()), status: jest.fn() };
    gasTopup = { ensureGas: jest.fn().mockResolvedValue(undefined) };
    service = new BridgeService(config, logger, gasTopup as never, relay as unknown as RelayClient);
    (prisma.wallet.findMany as jest.Mock).mockResolvedValue([
      { address: USER, chain: 'EVM' },
      { address: SOL, chain: 'SOLANA' },
    ]);
  });

  it('quotes a move from Base to the user’s own Solana wallet, tops up gas, and returns the checked steps', async () => {
    const quote = await service.quote('u1', { from: 'base', to: 'solana', amountOut: '5000000' });
    expect(relay.quote).toHaveBeenCalledWith(expect.objectContaining({ user: USER, recipient: SOL, originChainId: 8453, destinationChainId: 792703809, tradeType: 'EXACT_OUTPUT', amount: '5000000' }));
    expect(gasTopup.ensureGas).toHaveBeenCalledWith(8453, USER, expect.objectContaining({ address: BASE_USDC }));
    expect(quote).toMatchObject({ from: 'base', to: 'solana', amountIn: '5021600', amountOut: '5000000', timeEstimateSeconds: 1 });
    expect(quote.steps.map((s) => s.id)).toEqual(['approve', 'deposit']);
    expect(quote.feeUsd).toBeCloseTo(0.0228, 4);
  });

  it('never moves to an address that is not one of the user’s own verified wallets', async () => {
    (prisma.wallet.findMany as jest.Mock).mockResolvedValue([{ address: USER, chain: 'EVM' }]); // no Solana wallet yet
    await expect(service.quote('u1', { from: 'base', to: 'solana', amountOut: '5000000' })).rejects.toThrow(/both chains/);
    expect(relay.quote).not.toHaveBeenCalled();
  });

  it('refuses moves out of Solana (phase 2), same-chain moves and dust', async () => {
    await expect(service.quote('u1', { from: 'solana', to: 'base', amountOut: '5000000' })).rejects.toThrow(/coming soon/);
    await expect(service.quote('u1', { from: 'base', to: 'base', amountOut: '5000000' })).rejects.toThrow(/different chains/);
    await expect(service.quote('u1', { from: 'base', to: 'solana', amountOut: '100000' })).rejects.toThrow(/start at/);
  });
});

describe('toEvmSteps', () => {
  it('rejects a step on another chain, from another wallet, carrying native value, or approving a non-USDC contract', () => {
    const bad = (patch: Record<string, unknown>, id = 'deposit') =>
      relayQuote({ steps: [{ id, kind: 'transaction', items: [{ status: 'incomplete', data: { from: USER, to: '0xdead', data: '0x', value: '0', chainId: 8453, ...patch } }] }] });
    expect(() => toEvmSteps(bad({ chainId: 56 }), 8453, USER, BASE_USDC)).toThrow(/wrong chain/);
    expect(() => toEvmSteps(bad({ from: '0x0000000000000000000000000000000000000001' }), 8453, USER, BASE_USDC)).toThrow(/different wallet/);
    expect(() => toEvmSteps(bad({ value: '1000' }), 8453, USER, BASE_USDC)).toThrow(/more than USDC/);
    expect(() => toEvmSteps(bad({}, 'approve'), 8453, USER, BASE_USDC)).toThrow(/other than USDC/);
    expect(() => toEvmSteps(relayQuote({ steps: [{ id: 'authorize', kind: 'signature', items: [] }] }), 8453, USER, BASE_USDC)).toThrow(/Unexpected step/);
  });

  it('sums the fees the user pays', () => {
    expect(feeUsd(relayQuote())).toBeCloseTo(0.0228, 4);
  });
});
