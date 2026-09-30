import { PUMPFUN_REALTIME_CHANNEL } from '@kamby/domain';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { curveStateFromPumpPortal, PumpPortalIngestionService } from './pumpportal-ingestion';

const mockPrisma = vi.hoisted(() => ({
  pumpFunToken: {
    createMany: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
}));
vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const MINT = 'DfkQHVB73aazxkNKm54NixEpDMinVC9XeSv1KgS3Uc8S';

// The real create event captured from PumpPortal on 2026-09-30 (a 10 SOL initial buy).
const REAL_CREATE = {
  mint: MINT,
  traderPublicKey: '6ATnpbwa43DtscAWjiR3uh5bEfpc4mhFpF42F5a5f68T',
  txType: 'create',
  bondingCurveKey: '7GQkhJfFEKSvNRoq3mu6dQ68jSGxBbx9B1XrfMeS6mFv',
  vTokensInBondingCurve: 804750000.000001,
  vSolInBondingCurve: 39.99999999999995,
  name: 'this is it',
  symbol: 'end',
  uri: 'https://metadata.j7tracker.io/metadata/qfvyS6LAGd.json',
  pool: 'pump',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    mintAddress: MINT,
    name: 'this is it',
    symbol: 'end',
    uri: null,
    virtualSolReserves: '40000000000',
    virtualTokenReserves: '804750000000001',
    realSolReserves: '10000000000',
    realTokenReserves: '524850000000001',
    tokenTotalSupply: '1000000000000000',
    complete: false,
    createdAt: new Date('2026-09-30T00:00:00Z'),
    graduatedAt: null,
    ...overrides,
  };
}

describe('curveStateFromPumpPortal', () => {
  it('turns the real create event into raw reserves — 10 SOL raised out of 40 virtual', () => {
    expect(curveStateFromPumpPortal(REAL_CREATE.vSolInBondingCurve, REAL_CREATE.vTokensInBondingCurve)).toEqual({
      virtualSolReserves: '40000000000',
      virtualTokenReserves: '804750000000001',
      realSolReserves: '10000000000',
      realTokenReserves: '524850000000001',
    });
  });

  it('rejects missing or nonsensical numbers instead of storing garbage', () => {
    expect(curveStateFromPumpPortal(undefined, 1)).toBeNull();
    expect(curveStateFromPumpPortal(0, 1)).toBeNull();
    expect(curveStateFromPumpPortal(Number.NaN, 1)).toBeNull();
  });
});

describe('PumpPortalIngestionService', () => {
  const publish = vi.fn();
  let service: PumpPortalIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.pumpFunToken.findMany.mockResolvedValue([row()]);
    service = new PumpPortalIngestionService(fakeLogger, { publish } as unknown as Redis);
  });

  it('writes a new launch with one createMany and publishes it with its progress', async () => {
    service.handleMessage(REAL_CREATE);
    await service.flush();

    expect(mockPrisma.pumpFunToken.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ mintAddress: MINT, bondingCurveAddress: REAL_CREATE.bondingCurveKey, symbol: 'end', realSolReserves: '10000000000', tokenTotalSupply: '1000000000000000' })],
      skipDuplicates: true,
    });
    expect(publish).toHaveBeenCalledWith(PUMPFUN_REALTIME_CHANNEL, expect.any(String));
    const payload = JSON.parse(publish.mock.calls[0]![1] as string);
    expect(payload.tokens[0]).toMatchObject({ mintAddress: MINT, graduationProgressPct: 11.76 });
  });

  it('coalesces a burst of trades on one coin into a single row write with the latest state', async () => {
    for (const vSol of [41, 42, 43]) service.handleMessage({ mint: MINT, txType: 'buy', pool: 'pump', vSolInBondingCurve: vSol, vTokensInBondingCurve: 700_000_000 });
    await service.flush();

    expect(mockPrisma.pumpFunToken.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pumpFunToken.updateMany).toHaveBeenCalledWith({
      where: { mintAddress: MINT },
      data: expect.objectContaining({ realSolReserves: '13000000000' }),
    });
  });

  it('marks a graduation complete, setting graduatedAt only if it was never set', async () => {
    service.handleMessage({ mint: MINT, txType: 'migrate', pool: 'pump-amm' });
    await service.flush();

    expect(mockPrisma.pumpFunToken.updateMany).toHaveBeenCalledWith({ where: { mintAddress: MINT, graduatedAt: null }, data: expect.objectContaining({ complete: true, graduatedAt: expect.any(Date) }) });
    expect(mockPrisma.pumpFunToken.updateMany).toHaveBeenCalledWith({ where: { mintAddress: MINT }, data: { complete: true } });
  });

  it('ignores other launchpads and messages without a mint', async () => {
    service.handleMessage({ ...REAL_CREATE, pool: 'bonk' });
    service.handleMessage({ txType: 'create' });
    await service.flush();

    expect(mockPrisma.pumpFunToken.createMany).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('never publishes a coin the database does not have (a trade for an unseen mint)', async () => {
    mockPrisma.pumpFunToken.findMany.mockResolvedValue([]);
    service.handleMessage({ mint: 'Unknown111111111111111111111111111111111111', txType: 'sell', pool: 'pump', vSolInBondingCurve: 35, vTokensInBondingCurve: 900_000_000 });
    await service.flush();

    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps the stream alive when a flush fails — the batch is dropped and logged', async () => {
    mockPrisma.pumpFunToken.createMany.mockRejectedValueOnce(new Error('db down'));
    service.handleMessage(REAL_CREATE);
    await expect(service.flush()).resolves.toBeUndefined();
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});
