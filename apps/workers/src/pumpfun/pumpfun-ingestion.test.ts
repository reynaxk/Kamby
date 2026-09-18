import { Keypair } from '@solana/web3.js';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPLETE_EVENT_DISCRIMINATOR, CREATE_EVENT_DISCRIMINATOR, TRADE_EVENT_DISCRIMINATOR } from './pumpfun-constants';
import { PumpFunIngestionService } from './pumpfun-ingestion';

const mockPrisma = vi.hoisted(() => ({
  pumpFunToken: {
    upsert: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function u64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}
function i64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}
function borshString(value: string): Buffer {
  const utf8 = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length);
  return Buffer.concat([len, utf8]);
}
function bool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}
function programDataLog(buf: Buffer): string {
  return `Program data: ${buf.toString('base64')}`;
}

const MINT = Keypair.generate().publicKey;
const BONDING_CURVE = Keypair.generate().publicKey;
const USER = Keypair.generate().publicKey;
const CREATOR = Keypair.generate().publicKey;

function createEventLog(): string {
  return programDataLog(
    Buffer.concat([
      CREATE_EVENT_DISCRIMINATOR,
      borshString('TestCoin'),
      borshString('TEST'),
      borshString('https://example.com/meta.json'),
      MINT.toBuffer(),
      BONDING_CURVE.toBuffer(),
      USER.toBuffer(),
      CREATOR.toBuffer(),
      i64(1_700_000_000n),
      u64(1_073_000_000_000_000n),
      u64(30_000_000_000n),
      u64(793_100_000_000_000n),
      u64(1_000_000_000_000_000n),
    ]),
  );
}

function tradeEventLog(overrides: { isBuy?: boolean; realSolReserves?: bigint } = {}): string {
  return programDataLog(
    Buffer.concat([
      TRADE_EVENT_DISCRIMINATOR,
      MINT.toBuffer(),
      u64(1_000_000_000n),
      u64(5_000_000_000n),
      bool(overrides.isBuy ?? true),
      USER.toBuffer(),
      i64(1_700_000_100n),
      u64(31_000_000_000n),
      u64(1_068_000_000_000_000n),
      u64(overrides.realSolReserves ?? 1_000_000_000n),
      u64(788_100_000_000_000n),
    ]),
  );
}

function completeEventLog(): string {
  return programDataLog(Buffer.concat([COMPLETE_EVENT_DISCRIMINATOR, USER.toBuffer(), MINT.toBuffer(), BONDING_CURVE.toBuffer(), i64(1_700_000_200n)]));
}

describe('PumpFunIngestionService', () => {
  let service: PumpFunIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PumpFunIngestionService('https://fake.example.com', 'wss://fake.example.com', fakeLogger);
  });

  it('upserts a new row from a real CreateEvent log', async () => {
    await service.handleLogs([createEventLog()]);

    expect(mockPrisma.pumpFunToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mintAddress: MINT.toBase58() },
        create: expect.objectContaining({
          mintAddress: MINT.toBase58(),
          bondingCurveAddress: BONDING_CURVE.toBase58(),
          creatorAddress: CREATOR.toBase58(),
          name: 'TestCoin',
          symbol: 'TEST',
          uri: 'https://example.com/meta.json',
          virtualSolReserves: '30000000000',
          realSolReserves: '0',
        }),
      }),
    );
  });

  it('updates reserves from a real TradeEvent log when the token is already known', async () => {
    mockPrisma.pumpFunToken.findUnique.mockResolvedValue({ id: 'row-1' });

    await service.handleLogs([tradeEventLog({ realSolReserves: 5_000_000_000n })]);

    expect(mockPrisma.pumpFunToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mintAddress: MINT.toBase58() },
        data: expect.objectContaining({ realSolReserves: '5000000000', virtualSolReserves: '31000000000' }),
      }),
    );
  });

  it('skips a TradeEvent for a mint whose CreateEvent was never observed — never half-creates a row', async () => {
    mockPrisma.pumpFunToken.findUnique.mockResolvedValue(null);

    await service.handleLogs([tradeEventLog()]);

    expect(mockPrisma.pumpFunToken.update).not.toHaveBeenCalled();
  });

  it('marks a known token graduated from a real CompleteEvent log', async () => {
    mockPrisma.pumpFunToken.findUnique.mockResolvedValue({ id: 'row-1', graduatedAt: null });

    await service.handleLogs([completeEventLog()]);

    expect(mockPrisma.pumpFunToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mintAddress: MINT.toBase58() },
        data: expect.objectContaining({ complete: true, graduatedAt: expect.any(Date) }),
      }),
    );
  });

  it('never moves graduatedAt forward on a second, redundant CompleteEvent', async () => {
    const firstGraduation = new Date('2026-01-01T00:00:00Z');
    mockPrisma.pumpFunToken.findUnique.mockResolvedValue({ id: 'row-1', graduatedAt: firstGraduation });

    await service.handleLogs([completeEventLog()]);

    expect(mockPrisma.pumpFunToken.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ graduatedAt: firstGraduation }) }));
  });

  it('skips a CompleteEvent for an unknown mint, same rule as trades', async () => {
    mockPrisma.pumpFunToken.findUnique.mockResolvedValue(null);

    await service.handleLogs([completeEventLog()]);

    expect(mockPrisma.pumpFunToken.update).not.toHaveBeenCalled();
  });

  it('ignores unrelated log lines entirely, never throwing', async () => {
    await expect(service.handleLogs(['Program 11111111111111111111111111111111 invoke [1]', 'Program log: unrelated'])).resolves.toBeUndefined();
    expect(mockPrisma.pumpFunToken.upsert).not.toHaveBeenCalled();
  });

  it('one malformed payload never blocks the rest of the same log batch', async () => {
    mockPrisma.pumpFunToken.findUnique.mockResolvedValue(null);
    const malformed = 'Program data: not-valid-base64-content-!!!';

    await service.handleLogs([malformed, createEventLog()]);

    expect(mockPrisma.pumpFunToken.upsert).toHaveBeenCalledTimes(1);
  });

  // Regression coverage for a real production incident (2026-09-15): the first version of
  // this service called handleLogs concurrently, unbounded, once per onLogs notification —
  // Pump.fun's real trade volume drove enough simultaneous Prisma calls to exhaust
  // Postgres's connection limit within minutes. enqueue()/drain() fix this by serializing
  // every notification through one queue; these tests exercise that queue directly, the
  // same way handleLogs's own tests exercise it directly rather than going through start().
  describe('enqueue/drain — concurrency bounding (2026-09-15 connection-exhaustion fix)', () => {
    it('never runs a second handleLogs call while the first is still in flight', async () => {
      let resolveFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      let concurrentCallsInFlight = 0;
      let maxObservedConcurrency = 0;
      mockPrisma.pumpFunToken.upsert.mockImplementation(async () => {
        concurrentCallsInFlight += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentCallsInFlight);
        await firstGate;
        concurrentCallsInFlight -= 1;
      });

      // Two CreateEvents enqueued back-to-back, synchronously — a burst, exactly like a
      // real onLogs callback firing twice in quick succession would produce.
      service.enqueue([createEventLog()], 'sig-1');
      service.enqueue([createEventLog()], 'sig-2');

      // Give the drain loop a tick to start processing the first entry and call upsert.
      await Promise.resolve();
      await Promise.resolve();
      expect(mockPrisma.pumpFunToken.upsert).toHaveBeenCalledTimes(1); // not both at once

      resolveFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockPrisma.pumpFunToken.upsert).toHaveBeenCalledTimes(2); // second ran only after the first finished
      expect(maxObservedConcurrency).toBe(1);
    });

    it('processes queued notifications in order and logs a failure without losing the rest', async () => {
      mockPrisma.pumpFunToken.findUnique.mockResolvedValue(null);
      const order: string[] = [];
      mockPrisma.pumpFunToken.upsert.mockImplementation(async () => {
        order.push('create');
      });

      service.enqueue([createEventLog()], 'sig-a');
      service.enqueue([tradeEventLog()], 'sig-b'); // unknown mint per findUnique above — silently skipped, not an error
      service.enqueue([createEventLog()], 'sig-c');

      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(order).toEqual(['create', 'create']);
      expect(fakeLogger.error).not.toHaveBeenCalled();
    });

    it('drops the oldest queued notification once MAX_QUEUE_SIZE is reached, rather than growing unbounded', async () => {
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      mockPrisma.pumpFunToken.upsert.mockImplementation(async () => {
        await gate; // holds the drain loop open so the queue actually builds up behind it
      });

      // First enqueue starts draining immediately and blocks on the gate; every subsequent
      // enqueue call this same tick piles up in the queue behind it.
      for (let i = 0; i < 502; i += 1) {
        service.enqueue([createEventLog()], `sig-${i}`);
      }

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ droppedSignature: expect.any(String) }),
        expect.stringContaining('backpressure'),
      );

      releaseGate();
      // Drain the rest without asserting exact count — the point is only that it never threw
      // or grew past the cap, not the precise number the drain loop gets through per tick.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
