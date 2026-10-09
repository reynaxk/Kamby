import WebSocket from 'ws';
import type { PinoLogger } from 'nestjs-pino';

/** One trade-driven price from Bitquery: a pool's 1-second close for a token. */
export interface BitqueryTick {
  /** Token address as Bitquery reports it (EVM lowercased by the caller's matching). */
  address: string;
  /** '*' — the price aggregates every pool of the coin (Trading.Tokens). */
  pool: string;
  priceUsd: number;
  blockTimeMs: number;
}

const ENDPOINT = 'wss://streaming.bitquery.io/graphql';
/** Subscription changes are batched — viewers opening coins one after another resubscribe once. */
const RESUBSCRIBE_DEBOUNCE_MS = 3_000;
/** Data stops without an error when a plan's stream cap is hit, so silence itself is a failure. */
const SILENCE_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;
/** Bitquery prices this many coins per subscription at most; the rest stay on the polled sources. */
const MAX_TOKENS = 200;

/**
 * Bitquery's live price stream (2026-10-08, after a trial measured 0.5s median from block to
 * arrival vs DexScreener's polled ~1.5-3s). One websocket for the coins anyone is viewing right
 * now: `Trading.Tokens` 1-second closes in USD, aggregated over every pool of each coin (2026-10-09:
 * the per-pool `Trading.Pairs` stream barely moved on Solana, where a coin's trades are spread over
 * PumpSwap, Meteora and Raydium pools; the owner compared both live and chose this). The socket is closed whenever nobody is watching anything (stream-minutes
 * are billed while it's open), and treated as down after SILENCE_MS without data so the polled
 * sources take over at once. Off unless BITQUERY_API_KEY is set.
 */
export class BitqueryPriceStream {
  private socket: WebSocket | null = null;
  private tokens: string[] = [];
  private subscribedKey = '';
  private subscriptionId = 0;
  private acked = false;
  private debounce: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private backoffMs = 2_000;
  private lastDataAt = 0;
  private stopped = false;

  constructor(
    private readonly apiKey: string,
    private readonly logger: PinoLogger,
    private readonly onTick: (tick: BitqueryTick) => void,
    /** Bytes received, for the data meter (plans cap GB of stream data per month). */
    private readonly onBytes: (bytes: number) => void = () => undefined,
  ) {}

  /** Stops streaming until resume() — the monthly data cap was reached. */
  private paused = false;

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.close();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.subscribedKey = '';
    this.apply();
  }

  /** True while data has arrived recently — the caller trusts Bitquery's price only then. */
  isLive(): boolean {
    return Date.now() - this.lastDataAt < SILENCE_MS;
  }

  /** The coins to stream (any chain). An empty list closes the socket. */
  setTokens(addresses: string[]): void {
    const next = [...new Set(addresses)].sort().slice(0, MAX_TOKENS);
    if (next.join(',') === this.tokens.join(',')) return;
    this.tokens = next;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.apply(), RESUBSCRIBE_DEBOUNCE_MS);
    this.debounce.unref?.();
  }

  stop(): void {
    this.stopped = true;
    this.close();
  }

  private apply(): void {
    if (this.stopped || this.paused) return;
    if (this.tokens.length === 0) {
      this.close();
      return;
    }
    if (!this.socket) {
      this.connect();
      return;
    }
    if (this.acked) this.subscribe();
  }

  private connect(): void {
    this.acked = false;
    this.subscribedKey = '';
    const socket = new WebSocket(`${ENDPOINT}?token=${encodeURIComponent(this.apiKey)}`, ['graphql-ws']);
    this.socket = socket;
    socket.on('open', () => socket.send(JSON.stringify({ type: 'connection_init', payload: {} })));
    socket.on('message', (raw) => {
      const text = raw.toString();
      this.onBytes(Buffer.byteLength(text));
      this.handle(text);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.acked = false;
      if (!this.stopped && !this.paused && this.tokens.length > 0) this.scheduleReconnect();
    });
    socket.on('error', (error) => {
      this.logger.warn({ err: String(error).replace(this.apiKey, '[key]') }, 'Bitquery stream error');
      socket.close();
    });
  }

  private handle(text: string): void {
    let message: { type?: string; payload?: { data?: { Trading?: unknown } } & Record<string, unknown> };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === 'connection_ack') {
      this.acked = true;
      this.backoffMs = 2_000;
      this.subscribe();
      return;
    }
    if (message.type === 'error' || message.type === 'connection_error') {
      this.logger.warn({ payload: JSON.stringify(message.payload ?? {}).slice(0, 300) }, 'Bitquery stream rejected the subscription');
      return;
    }
    if (message.type !== 'data') return;
    this.lastDataAt = Date.now();
    this.armSilence();
    for (const row of (message.payload?.data?.Trading as { Tokens?: unknown[] } | undefined)?.Tokens ?? []) {
      const r = row as { Token?: { Address?: string }; Price?: { Ohlc?: { Close?: number } }; Block?: { Time?: string } };
      const priceUsd = r.Price?.Ohlc?.Close;
      const address = r.Token?.Address;
      if (!address || typeof priceUsd !== 'number' || !(priceUsd > 0)) continue;
      this.onTick({ address, pool: '*', priceUsd, blockTimeMs: Date.parse(r.Block?.Time ?? '') || Date.now() });
    }
  }

  private subscribe(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const key = this.tokens.join(',');
    if (key === this.subscribedKey) return;
    if (this.subscriptionId > 0) socket.send(JSON.stringify({ id: String(this.subscriptionId), type: 'stop' }));
    this.subscriptionId += 1;
    this.subscribedKey = key;
    const query = `subscription {
  Trading {
    Tokens(where: { Token: { Address: { in: ${JSON.stringify(this.tokens)} } }, Interval: { Time: { Duration: { eq: 1 } } } }) {
      Token { Address }
      Price { Ohlc { Close } }
      Block { Time }
    }
  }
}`;
    socket.send(JSON.stringify({ id: String(this.subscriptionId), type: 'start', payload: { query } }));
    this.armSilence();
    this.logger.info({ tokens: this.tokens.length }, 'Bitquery live prices subscribed');
  }

  private armSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (!this.socket || this.tokens.length === 0) return;
      this.logger.warn('Bitquery stream silent for 60s — reconnecting (polled prices in use meanwhile)');
      this.socket.terminate();
    }, SILENCE_MS);
    this.silenceTimer.unref?.();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && this.tokens.length > 0 && !this.socket) this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private close(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.acked = false;
    this.subscribedKey = '';
    if (socket) {
      try {
        if (this.subscriptionId > 0 && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: String(this.subscriptionId), type: 'stop' }));
      } catch {
        // closing anyway
      }
      socket.close();
    }
  }
}
