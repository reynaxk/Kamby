import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CRYPTO_MAJORS, type CryptoMajor, type CryptoPrice } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { BehaviorSubject, type Observable } from 'rxjs';
import WebSocket from 'ws';

export const COINBASE_FEED_URL = 'wss://ws-feed.exchange.coinbase.com';
const PRODUCT_IDS: Record<CryptoMajor, string> = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', BNB: 'BNB-USD', AVAX: 'AVAX-USD' };
const SYMBOL_BY_PRODUCT = new Map(Object.entries(PRODUCT_IDS).map(([symbol, product]) => [product, symbol as CryptoMajor]));
/** BTC alone ticks several times a second — the stream never needs more than this. */
const EMIT_EVERY_MS = 1_000;
const SILENCE_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface CoinbaseTicker {
  type?: string;
  product_id?: string;
  price?: string;
  open_24h?: string;
  time?: string;
}

/** Exported for tests. Null for anything that isn't a usable ticker for one of the majors. */
export function priceFromTicker(message: CoinbaseTicker): CryptoPrice | null {
  if (message.type !== 'ticker' || !message.product_id) return null;
  const symbol = SYMBOL_BY_PRODUCT.get(message.product_id);
  const priceUsd = Number(message.price);
  if (!symbol || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const open = Number(message.open_24h);
  return {
    symbol,
    priceUsd,
    change24hPct: Number.isFinite(open) && open > 0 ? ((priceUsd - open) / open) * 100 : null,
    updatedAtIso: message.time ?? new Date().toISOString(),
  };
}

/**
 * The Crypto tab's BTC/ETH/SOL/BNB/AVAX prices, from Coinbase Exchange's public ticker
 * WebSocket — free, keyless, and US-hosted, so nothing geo-blocks it from this API. One
 * upstream connection per API process, fanned out to every browser through the market feed
 * stream (see MarketFeedsService), so viewers never poll anything themselves.
 *
 * `prices$` replays the latest known prices to new subscribers and emits at most once per
 * EMIT_EVERY_MS. A dead or silent socket reconnects with capped backoff; prices already
 * known stay served (each carries its own `updatedAtIso`) rather than disappearing.
 */
@Injectable()
export class CryptoPriceService implements OnModuleInit, OnModuleDestroy {
  private readonly latest = new Map<CryptoMajor, CryptoPrice>();
  private readonly subject = new BehaviorSubject<CryptoPrice[]>([]);
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('CryptoPriceService');
  }

  onModuleInit(): void {
    // Jest runs never open a real socket; tests drive handleMessage directly.
    if (process.env.NODE_ENV === 'test') return;
    this.connect();
    this.emitTimer = setInterval(() => this.emitIfDirty(), EMIT_EVERY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.emitTimer) clearInterval(this.emitTimer);
    this.socket?.close();
  }

  get prices$(): Observable<CryptoPrice[]> {
    return this.subject.asObservable();
  }

  /** Current prices in CRYPTO_MAJORS order — only the ones seen so far. */
  snapshot(): CryptoPrice[] {
    return CRYPTO_MAJORS.flatMap((symbol) => {
      const price = this.latest.get(symbol);
      return price ? [price] : [];
    });
  }

  /** Exported for tests. */
  handleMessage(message: CoinbaseTicker): void {
    const price = priceFromTicker(message);
    if (!price) return;
    this.latest.set(price.symbol, price);
    this.dirty = true;
  }

  /** Exported for tests. */
  emitIfDirty(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.subject.next(this.snapshot());
  }

  private connect(): void {
    const socket = new WebSocket(COINBASE_FEED_URL);
    this.socket = socket;
    socket.on('open', () => {
      this.reconnectAttempt = 0;
      socket.send(JSON.stringify({ type: 'subscribe', product_ids: Object.values(PRODUCT_IDS), channels: ['ticker'] }));
      this.armSilenceTimer();
      this.logger.info('Coinbase ticker stream connected');
    });
    socket.on('message', (raw) => {
      this.armSilenceTimer();
      try {
        this.handleMessage(JSON.parse(raw.toString()) as CoinbaseTicker);
      } catch {
        // A malformed frame is skipped, never allowed to kill the stream.
      }
    });
    socket.on('close', () => this.scheduleReconnect());
    socket.on('error', (error) => {
      this.logger.warn({ err: error }, 'Coinbase ticker stream error');
      socket.close();
    });
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.socket?.terminate(), SILENCE_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
