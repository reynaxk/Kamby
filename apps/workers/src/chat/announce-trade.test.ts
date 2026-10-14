import { SOLANA_USDC_MINT, TOKEN_CHAT_REALTIME_CHANNEL, USDC_ADDRESS_BASE } from '@kamby/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { announceSweptTrade } from './announce-trade';

const mockPrisma = vi.hoisted(() => ({
  tradeTransaction: { findUnique: vi.fn() },
  solanaTradeTransaction: { findUnique: vi.fn() },
}));
vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const user = { username: 'sam', avatarUrl: null, wallets: [{ address: '0xabc' }] };
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

describe('announceSweptTrade', () => {
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  beforeEach(() => vi.clearAllMocks());

  it("announces a swept Solana sell in the coin's chat with its USDC amount", async () => {
    mockPrisma.solanaTradeTransaction.findUnique.mockResolvedValue({ id: 's1', side: 'SELL', inputMint: WIF, outputMint: SOLANA_USDC_MINT, inputAmount: '1', expectedOutputAmount: '42500000', user });
    await announceSweptTrade(redis, { solanaTransactionId: 's1' });
    const [channel, json] = redis.publish.mock.calls[0]!;
    expect(channel).toBe(TOKEN_CHAT_REALTIME_CHANNEL);
    expect(JSON.parse(json as string).item).toMatchObject({ kind: 'trade', tokenKey: `solana:${WIF}`, side: 'SELL', usd: 42.5, author: { username: 'sam' } });
  });

  it('announces an EVM buy paid in USDC, and skips one that was not', async () => {
    const row = { id: 'e1', side: 'BUY', chainId: 8453, inputToken: USDC_ADDRESS_BASE, outputToken: '0xToken', inputAmount: '25000000', expectedOutputAmount: '1', tokenMarket: { token: { contractAddress: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' } }, user };
    mockPrisma.tradeTransaction.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, inputToken: '0xWeth' });
    await announceSweptTrade(redis, { evmTransactionId: 'e1' });
    expect(JSON.parse(redis.publish.mock.calls[0]![1] as string).item).toMatchObject({ tokenKey: 'eip155:8453:0x4ed4e862860bed51a9570b96d89af5e1b0efefed', usd: 25 });
    await announceSweptTrade(redis, { evmTransactionId: 'e1' });
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });
});
