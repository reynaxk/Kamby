import { prisma } from '@kamby/db';
import type { Redis } from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import { SolanaChartService, toCandles } from './solana-chart.service';
import { resetGraduatedPoolCaches } from './graduated-pools';

jest.mock('@kamby/db', () => ({
  prisma: { solanaTokenMarket: { findFirst: jest.fn() }, pumpFunToken: { findFirst: jest.fn() } },
}));
const mockedPrisma = jest.mocked(prisma, { shallow: true });

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger;

function memoryRedis() {
  const store = new Map<string, string>();
  return { get: jest.fn(async (k: string) => store.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void store.set(k, v)) } as unknown as Redis;
}

describe('toCandles', () => {
  it('turns GeckoTerminal rows (newest first) into Kamby candles, oldest first', () => {
    // Real BONK rows from 2026-09-30, trimmed.
    const rows = [
      [1790776800, 3.91e-6, 3.93e-6, 3.9e-6, 3.92e-6, 4280.6],
      [1790773200, 4.01e-6, 4.01e-6, 3.86e-6, 3.91e-6, 60700.9],
    ];
    expect(toCandles(rows)).toEqual([
      { bucketStart: '2026-09-30T13:00:00.000Z', open: 4.01e-6, high: 4.01e-6, low: 3.86e-6, close: 3.91e-6, volumeUsd: 60700.9 },
      { bucketStart: '2026-09-30T14:00:00.000Z', open: 3.91e-6, high: 3.93e-6, low: 3.9e-6, close: 3.92e-6, volumeUsd: 4280.6 },
    ]);
  });

  it('drops malformed rows instead of guessing', () => {
    expect(toCandles([[1, 2, 3], [1790773200, 1, 1, 1, 'x', 1], null])).toEqual([]);
    expect(toCandles(undefined)).toEqual([]);
  });
});

describe('SolanaChartService', () => {
  const ohlcv = { data: { attributes: { ohlcv_list: [[1790773200, 1, 2, 0.5, 1.5, 100]] } } };
  const pools = { data: [{ attributes: { address: 'PoolBonkSol' }, relationships: { base_token: { data: { id: `solana_${BONK}` } } } }] };

  beforeEach(() => {
    jest.clearAllMocks();
    resetGraduatedPoolCaches();
    (mockedPrisma.solanaTokenMarket.findFirst as jest.Mock).mockResolvedValue({ id: 'bonk' });
    (mockedPrisma.pumpFunToken.findFirst as jest.Mock).mockResolvedValue(null);
    global.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes('/ohlcv/') ? ohlcv : pools) })) as unknown as typeof fetch;
  });

  it("serves a listed coin's candles from its main pool, at the requested width", async () => {
    const candles = await new SolanaChartService(memoryRedis(), logger).history(BONK, '4H');

    expect(candles).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(`/pools/PoolBonkSol/ohlcv/hour?aggregate=4&limit=200&currency=usd&token=${BONK}`), expect.anything());
  });

  it('shares cached responses across viewers instead of calling GeckoTerminal each time', async () => {
    const service = new SolanaChartService(memoryRedis(), logger);
    await service.history(BONK, '1H');
    await service.history(BONK, '1H');

    expect(global.fetch).toHaveBeenCalledTimes(3); // DexScreener + GeckoTerminal pool lookups + one candles call — none repeated for the second viewer
  });

  it('refuses coins Kamby does not list, so arbitrary mints cannot spend the shared GeckoTerminal budget', async () => {
    (mockedPrisma.solanaTokenMarket.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(new SolanaChartService(memoryRedis(), logger).history('Unknown1111111111111111111111111111111111', '1H')).rejects.toThrow('does not list');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps serving the last good candles when GeckoTerminal rate-limits, instead of an empty chart', async () => {
    const redis = memoryRedis();
    const service = new SolanaChartService(redis, logger);
    expect(await service.history(BONK, '1m')).toHaveLength(1);

    // The fresh entry expires; the next lookup hits a 429.
    await redis.set(`solana-chart:candles:${BONK}:1m`, 'x');
    (redis.get as jest.Mock).mockImplementation(async (k: string) =>
      k === `solana-chart:candles:${BONK}:1m` ? null : k.endsWith(':last-good') ? JSON.stringify([{ bucketStart: 'kept', open: 1, high: 1, low: 1, close: 1, volumeUsd: 0 }]) : null,
    );
    global.fetch = jest.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;

    const candles = await service.history(BONK, '1m');
    expect(candles).toEqual([{ bucketStart: 'kept', open: 1, high: 1, low: 1, close: 1, volumeUsd: 0 }]);
  });

  it('rejects widths GeckoTerminal cannot serve as true candles', async () => {
    await expect(new SolanaChartService(memoryRedis(), logger).history(BONK, '1W')).rejects.toThrow('timeframe must be one of');
  });
});
