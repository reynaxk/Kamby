import { Prisma, prisma } from '@kamby/db';
import {
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_PREFERENCE_FIELD,
  NOTIFICATION_REALTIME_CHANNEL,
  NotificationPayloadSchema,
  notificationDeepLink,
  priceMoveDedupeKey,
  tradeOutcomeDedupeKey,
  type NotificationPayload,
  type NotificationPreferences,
  type NotificationType,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import webpush from 'web-push';
import { dmPushCopy, missedVideoTitle, pushCopy } from './push-copy';

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS_BY_CHAIN_ID: Record<number, number> = { 8453: 6, 56: 18 };
const CHAIN_IDENTIFIER_BY_ID: Record<number, string> = { 8453: 'eip155:8453', 56: 'eip155:56' };
/** Only rows this fresh are pushed — a backlog after downtime stays in the app, not on phones. */
const PUSH_WINDOW_MINUTES = 10;
/** Trades whose outcome landed this recently become notifications (dedupe covers re-reads). */
const TRADE_LOOKBACK_MINUTES = 30;
const PRICE_SAMPLES_KEY = (tokenKey: string) => `kamby:pricemove:${tokenKey}`;
const PRICE_MOVE_COOLDOWN_SECONDS = 3 * 3600;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * The newer notification types and phone delivery (2026-10-11):
 *
 * - **Trade outcomes** — your own EVM/Solana trade reaching CONFIRMED or FAILED/EXPIRED. Read
 *   from the trade tables (the API's on-demand check and this app's sweeps both write those
 *   statuses), so every path is covered from one place; the (user, type, dedupeKey) unique
 *   constraint makes re-reads harmless.
 * - **Price moves** — a held or watched coin moving ≥ NOTIFICATION_DEFAULTS.priceMovePct within
 *   an hour. Prices are sampled every run into Redis (EVM: TokenMarket; Solana: the listed
 *   market, else DexScreener's free token endpoint) and compared with the sample an hour back.
 * - **Push dispatch** — every fresh notification row, of any type and from any writer, is
 *   claimed once (`FOR UPDATE SKIP LOCKED`, safe with several replicas) and sent to the
 *   recipient's subscribed phones in their language. Dead subscriptions (404/410) are removed.
 *
 * Every step logs and swallows its own errors — a failed tick never affects trading.
 */
export class NotificationExtrasService {
  private readonly pushReady: boolean;

  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
    vapid: VapidConfig | null,
  ) {
    this.pushReady = vapid !== null;
    if (vapid) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  // --- Trade outcomes -----------------------------------------------------------------------

  async notifyTradeOutcomes(): Promise<number> {
    const since = new Date(Date.now() - TRADE_LOOKBACK_MINUTES * 60_000);
    const [evm, solana] = await Promise.all([
      prisma.tradeTransaction.findMany({
        where: { status: { in: ['CONFIRMED', 'FAILED', 'EXPIRED'] }, updatedAt: { gte: since } },
        include: { tokenMarket: { include: { token: true } } },
        take: 200,
      }),
      prisma.solanaTradeTransaction.findMany({
        where: { status: { in: ['CONFIRMED', 'FAILED', 'EXPIRED'] }, updatedAt: { gte: since } },
        take: 200,
      }),
    ]);

    const items: { userId: string; type: NotificationType; dedupeKey: string; tokenMarketId?: string; payload: NotificationPayload }[] = [];
    for (const t of evm) {
      const decimals = USDC_DECIMALS_BY_CHAIN_ID[t.chainId] ?? 6;
      const usdcRaw = t.side === 'BUY' ? t.inputAmount : t.expectedOutputAmount;
      items.push({
        userId: t.userId,
        type: t.status === 'CONFIRMED' ? 'TRADE_CONFIRMED' : 'TRADE_FAILED',
        dedupeKey: tradeOutcomeDedupeKey('evm', t.id),
        tokenMarketId: t.tokenMarketId,
        payload: {
          chainIdentifier: CHAIN_IDENTIFIER_BY_ID[t.chainId],
          tokenAddress: t.tokenMarket.token.contractAddress,
          symbol: t.tokenMarket.token.symbol,
          logoUrl: t.tokenMarket.token.logoUrl,
          side: t.side === 'SELL' ? 'SELL' : 'BUY',
          amountUsd: rawToNumber(usdcRaw, decimals),
          tradeId: t.id,
        },
      });
    }
    const mints = [...new Set(solana.map((t) => (t.side === 'SELL' ? t.inputMint : t.outputMint)))];
    const names = await solanaNames(mints);
    for (const t of solana) {
      const mint = t.side === 'SELL' ? t.inputMint : t.outputMint;
      const usdcRaw = t.side === 'SELL' ? (t.outputMint === SOLANA_USDC_MINT ? t.expectedOutputAmount : null) : t.inputMint === SOLANA_USDC_MINT ? t.inputAmount : null;
      items.push({
        userId: t.userId,
        type: t.status === 'CONFIRMED' ? 'TRADE_CONFIRMED' : 'TRADE_FAILED',
        dedupeKey: tradeOutcomeDedupeKey('solana', t.id),
        payload: {
          chainIdentifier: 'solana',
          tokenAddress: mint,
          symbol: names.get(mint) ?? null,
          side: t.side === 'SELL' ? 'SELL' : 'BUY',
          amountUsd: usdcRaw !== null ? rawToNumber(usdcRaw, 6) : null,
        },
      });
    }
    return this.createFiltered(items);
  }

  // --- Price moves --------------------------------------------------------------------------

  async notifyPriceMoves(): Promise<number> {
    const now = Date.now();
    // Who holds what (open lots) and who watches what.
    const [lots, watches] = await Promise.all([
      prisma.tokenLot.findMany({
        where: { quantityRemainingRaw: { not: '0' } },
        select: { userId: true, evmTokenId: true, solanaMint: true },
      }),
      prisma.tokenWatch.findMany({ select: { userId: true, tokenMarket: { select: { tokenId: true } } } }),
    ]);
    const audience = new Map<string, Set<string>>(); // tokenKey → userIds
    const add = (key: string, userId: string) => {
      const set = audience.get(key) ?? new Set<string>();
      set.add(userId);
      audience.set(key, set);
    };
    for (const l of lots) {
      if (l.evmTokenId) add(`evm:${l.evmTokenId}`, l.userId);
      else if (l.solanaMint) add(`sol:${l.solanaMint}`, l.userId);
    }
    for (const w of watches) add(`evm:${w.tokenMarket.tokenId}`, w.userId);
    if (audience.size === 0) return 0;

    const prices = await this.currentPrices([...audience.keys()]);
    const items: { userId: string; type: NotificationType; dedupeKey: string; tokenMarketId?: string; payload: NotificationPayload }[] = [];
    const bucket = new Date(Math.floor(now / 3_600_000) * 3_600_000).toISOString();
    const windowMs = NOTIFICATION_DEFAULTS.priceMoveWindowMinutes * 60_000;

    for (const [tokenKey, info] of prices) {
      const key = PRICE_SAMPLES_KEY(tokenKey);
      const raw = await this.redis.lrange(key, 0, 40).catch(() => [] as string[]);
      await this.redis
        .multi()
        .lpush(key, JSON.stringify({ t: now, p: info.price }))
        .ltrim(key, 0, 40)
        .expire(key, 3 * 3600)
        .exec()
        .catch(() => undefined);
      // The sample closest to an hour ago (within 50–75 minutes).
      const samples = raw.map((s) => JSON.parse(s) as { t: number; p: number });
      const past = samples
        .filter((s) => now - s.t >= windowMs - 10 * 60_000 && now - s.t <= windowMs + 15 * 60_000 && s.p > 0)
        .sort((a, b) => Math.abs(now - a.t - windowMs) - Math.abs(now - b.t - windowMs))[0];
      if (!past) continue;
      const pct = ((info.price - past.p) / past.p) * 100;
      if (Math.abs(pct) < NOTIFICATION_DEFAULTS.priceMovePct) continue;
      // One move alert per coin per 3 hours, whichever way (owner 2026-10-11: three alerts for
      // the same meme coin within an hour was too many).
      const coolKey = `kamby:pricemove:cool:${tokenKey}`;
      const cooling = await this.redis.set(coolKey, '1', 'EX', PRICE_MOVE_COOLDOWN_SECONDS, 'NX').catch(() => 'OK');
      if (cooling !== 'OK') continue;
      const direction = pct > 0 ? 'up' : 'down';
      for (const userId of audience.get(tokenKey) ?? []) {
        items.push({
          userId,
          type: 'PRICE_MOVE',
          dedupeKey: priceMoveDedupeKey(tokenKey, direction, bucket),
          tokenMarketId: info.tokenMarketId,
          payload: {
            chainIdentifier: info.chainIdentifier,
            tokenAddress: info.tokenAddress,
            symbol: info.symbol,
            logoUrl: info.logoUrl,
            pct: Math.round(pct * 10) / 10,
            windowMinutes: NOTIFICATION_DEFAULTS.priceMoveWindowMinutes,
          },
        });
      }
    }
    return this.createFiltered(items);
  }

  /** Current USD price per coin key, with what the notification needs to show it. */
  private async currentPrices(
    keys: string[],
  ): Promise<Map<string, { price: number; tokenAddress: string; chainIdentifier: string; symbol: string | null; logoUrl: string | null; tokenMarketId?: string }>> {
    const out = new Map<string, { price: number; tokenAddress: string; chainIdentifier: string; symbol: string | null; logoUrl: string | null; tokenMarketId?: string }>();
    const evmIds = keys.filter((k) => k.startsWith('evm:')).map((k) => k.slice(4));
    const solMints = keys.filter((k) => k.startsWith('sol:')).map((k) => k.slice(4));

    if (evmIds.length > 0) {
      const markets = await prisma.tokenMarket.findMany({
        where: { tokenId: { in: evmIds }, priceUsd: { not: null } },
        orderBy: { liquidityUsd: 'desc' },
        select: { id: true, tokenId: true, priceUsd: true, token: { select: { contractAddress: true, symbol: true, logoUrl: true, chain: { select: { identifier: true } } } } },
      });
      for (const m of markets) {
        const key = `evm:${m.tokenId}`;
        if (out.has(key) || m.priceUsd === null) continue;
        out.set(key, {
          price: Number(m.priceUsd),
          tokenAddress: m.token.contractAddress,
          chainIdentifier: m.token.chain.identifier,
          symbol: m.token.symbol,
          logoUrl: m.token.logoUrl,
          tokenMarketId: m.id,
        });
      }
    }

    if (solMints.length > 0) {
      const listed = await prisma.solanaTokenMarket.findMany({
        where: { mintAddress: { in: solMints }, priceUsd: { not: null } },
        select: { mintAddress: true, priceUsd: true, symbol: true, logoUrl: true },
      });
      for (const m of listed) {
        out.set(`sol:${m.mintAddress}`, { price: Number(m.priceUsd), tokenAddress: m.mintAddress, chainIdentifier: 'solana', symbol: m.symbol, logoUrl: m.logoUrl });
      }
      // Pump.fun and other unlisted coins: DexScreener's free batch endpoint (30 per call).
      const missing = solMints.filter((mint) => !out.has(`sol:${mint}`)).slice(0, 90);
      for (let i = 0; i < missing.length; i += 30) {
        const batch = missing.slice(i, i + 30);
        try {
          const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(',')}`, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const pairs = (await res.json()) as { baseToken?: { address?: string; symbol?: string }; priceUsd?: string; liquidity?: { usd?: number }; info?: { imageUrl?: string } }[];
          const best = new Map<string, { price: number; liq: number; symbol: string | null; logo: string | null }>();
          for (const p of pairs) {
            const mint = p.baseToken?.address;
            const price = Number(p.priceUsd);
            if (!mint || !batch.includes(mint) || !(price > 0)) continue;
            const liq = p.liquidity?.usd ?? 0;
            const prev = best.get(mint);
            if (!prev || liq > prev.liq) best.set(mint, { price, liq, symbol: p.baseToken?.symbol ?? null, logo: p.info?.imageUrl ?? null });
          }
          for (const [mint, b] of best) out.set(`sol:${mint}`, { price: b.price, tokenAddress: mint, chainIdentifier: 'solana', symbol: b.symbol, logoUrl: b.logo });
        } catch (error) {
          this.logger.warn({ err: error }, 'price-move: DexScreener batch failed');
        }
      }
    }
    return out;
  }

  // --- Shared creation -------------------------------------------------------------------------

  /** Creates the notifications whose type the recipient hasn't switched off; duplicates are
   *  skipped by the unique constraint. Pings the app's live bell for each new one. */
  private async createFiltered(
    items: { userId: string; type: NotificationType; dedupeKey: string; tokenMarketId?: string; payload: NotificationPayload }[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const prefs = await preferencesFor([...new Set(items.map((i) => i.userId))]);
    let created = 0;
    for (const item of items) {
      const p = prefs.get(item.userId) ?? NOTIFICATION_DEFAULTS.preferenceDefaults;
      if (!p[NOTIFICATION_PREFERENCE_FIELD[item.type]]) continue;
      try {
        const row = await prisma.notification.create({
          data: {
            userId: item.userId,
            type: item.type,
            dedupeKey: item.dedupeKey,
            tokenMarketId: item.tokenMarketId,
            payload: item.payload as Prisma.InputJsonValue,
          },
          select: { id: true, createdAt: true },
        });
        created += 1;
        await this.redis
          .publish(NOTIFICATION_REALTIME_CHANNEL, JSON.stringify({ userId: item.userId, notificationId: row.id, type: item.type, atIso: row.createdAt.toISOString() }))
          .catch(() => undefined);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue; // already told
        this.logger.warn({ err: error, type: item.type }, 'notification create failed');
      }
    }
    return created;
  }

  // --- Push dispatch ---------------------------------------------------------------------------

  async dispatchPush(): Promise<{ claimed: number; sent: number; removed: number }> {
    if (!this.pushReady) return { claimed: 0, sent: 0, removed: 0 };
    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE notifications SET pushed_at = NOW()
      WHERE id IN (
        SELECT id FROM notifications
        WHERE pushed_at IS NULL AND created_at > NOW() - (${PUSH_WINDOW_MINUTES} * INTERVAL '1 minute')
        ORDER BY created_at
        LIMIT 200
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (claimed.length === 0) return { claimed: 0, sent: 0, removed: 0 };

    const rows = await prisma.notification.findMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      include: {
        actorUser: { select: { username: true } },
        actorWallet: { select: { address: true, user: { select: { username: true } } } },
        swap: { select: { volumeUsd: true, side: true, tokenMarket: { select: { token: { select: { symbol: true, contractAddress: true, chain: { select: { identifier: true } } } } } } } },
        tokenMarket: { select: { token: { select: { symbol: true, contractAddress: true, chain: { select: { identifier: true } } } } } },
      },
    });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const [prefs, subs] = await Promise.all([
      preferencesFor(userIds),
      prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } }),
    ]);
    const subsByUser = new Map<string, typeof subs>();
    for (const s of subs) subsByUser.set(s.userId, [...(subsByUser.get(s.userId) ?? []), s]);

    let sent = 0;
    let removed = 0;
    const jobs: Promise<void>[] = [];
    for (const row of rows) {
      const p = prefs.get(row.userId) ?? NOTIFICATION_DEFAULTS.preferenceDefaults;
      const targets = subsByUser.get(row.userId) ?? [];
      if (!p.pushEnabled || !p[NOTIFICATION_PREFERENCE_FIELD[row.type]] || targets.length === 0) continue;

      const parsed = row.payload ? NotificationPayloadSchema.safeParse(row.payload) : null;
      const payload = parsed?.success ? parsed.data : null;
      const token = row.swap?.tokenMarket.token ?? row.tokenMarket?.token ?? null;
      const symbol = token?.symbol ?? payload?.symbol ?? null;
      const tokenAddress = token?.contractAddress ?? payload?.tokenAddress ?? null;
      const actorAddress = row.actorWallet?.address ?? null;
      const actorName = row.actorUser?.username ?? row.actorWallet?.user?.username ?? (actorAddress ? short(actorAddress) : 'Someone');
      const amountUsd = row.swap ? Number(row.swap.volumeUsd) : (payload?.amountUsd ?? null);
      const side = row.swap ? (row.swap.side === 'buy' ? 'BUY' : 'SELL') : (payload?.side ?? null);
      const url =
        notificationDeepLink(row.type, {
          actorWalletAddress: actorAddress,
          tokenAddress,
          chainIdentifier: token?.chain.identifier ?? payload?.chainIdentifier ?? null,
          tradeId: payload?.tradeId ?? null,
          conversationId: payload?.conversationId ?? null,
          liveRoomId: payload?.liveRoomId ?? null,
        }) ?? '/notifications';
      // One chat's pushes replace each other on the phone (Instagram-style), the newest on top.
      const tag = payload?.conversationId ? `dm:${payload.conversationId}` : row.id;

      for (const sub of targets) {
        const { title, body } =
          row.type === 'DM_MESSAGE' && payload?.dmKind
            ? dmPushCopy(sub.locale, {
                actor: actorName,
                dmKind: payload.dmKind,
                chatTitle: payload.chatTitle ?? null,
                preview: payload.preview ?? '',
                emoji: payload.emoji ?? '',
              })
            : row.type === 'CALL_MISSED' && payload?.callVideo
              ? { ...pushCopy(sub.locale, row.type, { actor: actorName, token: '', amount: '', pct: '', side: null }), title: missedVideoTitle(sub.locale) }
            : row.type === 'FEED_REPLY'
              ? (() => {
                  // The reply's own words go into the body (2026-10-31).
                  const c = pushCopy(sub.locale, row.type, { actor: actorName, token: '', amount: '', pct: '', side: null });
                  return { ...c, body: c.body.replace('{preview}', payload?.preview ?? '') };
                })()
            : row.type === 'LIVE_STARTED' && payload?.liveTitle
              ? { ...pushCopy(sub.locale, row.type, { actor: actorName, token: '', amount: '', pct: '', side: null }), body: payload.liveTitle }
              : pushCopy(sub.locale, row.type, {
          actor: actorName,
          token: symbol ? `$${symbol.replace(/^\$+/, '')}` : tokenAddress ? short(tokenAddress) : 'a coin',
          amount: amountUsd !== null ? usd(amountUsd) : '',
          pct: payload?.pct !== undefined ? `${payload.pct > 0 ? '+' : ''}${payload.pct}%` : '',
          side,
          arrow: payload?.pct !== undefined ? (payload.pct > 0 ? '📈' : '📉') : '',
        });
        jobs.push(
          webpush
            .sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title, body, url, tag, renotify: tag !== row.id }),
              { TTL: row.type === 'CALL_INCOMING' ? 60 : 3600, urgency: row.type.startsWith('TRADE_') || row.type === 'PRICE_MOVE' || row.type === 'USDC_RECEIVED' || row.type === 'DM_MESSAGE' || row.type === 'CALL_INCOMING' || row.type === 'CALL_MISSED' || row.type === 'LIVE_STARTED' ? 'high' : 'normal' },
            )
            .then(() => {
              sent += 1;
            })
            .catch(async (error: { statusCode?: number }) => {
              if (error?.statusCode === 404 || error?.statusCode === 410) {
                removed += 1;
                await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } }).catch(() => undefined);
              } else {
                this.logger.warn({ statusCode: error?.statusCode }, 'push send failed');
              }
            }),
        );
      }
    }
    await Promise.all(jobs);
    return { claimed: claimed.length, sent, removed };
  }
}

async function preferencesFor(userIds: string[]): Promise<Map<string, NotificationPreferences>> {
  const rows = await prisma.notificationPreference.findMany({ where: { userId: { in: userIds } } });
  return new Map(
    rows.map((r) => [
      r.userId,
      {
        follows: r.follows,
        likes: r.likes,
        followedTraderTrades: r.followedTraderTrades,
        whaleTrades: r.whaleTrades,
        trendingTokens: r.trendingTokens,
        watchedTokenActivity: r.watchedTokenActivity,
        tradeUpdates: r.tradeUpdates,
        priceMoves: r.priceMoves,
        messages: r.messages,
        pushEnabled: r.pushEnabled,
      },
    ]),
  );
}

/** Symbols for Solana mints we list or track (listed market, else Pump.fun). */
async function solanaNames(mints: string[]): Promise<Map<string, string>> {
  if (mints.length === 0) return new Map();
  const [listed, pump] = await Promise.all([
    prisma.solanaTokenMarket.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true } }),
    prisma.pumpFunToken.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true } }),
  ]);
  const out = new Map<string, string>();
  for (const r of [...pump, ...listed]) if (r.symbol) out.set(r.mintAddress, r.symbol);
  return out;
}

function rawToNumber(raw: string, decimals: number): number | null {
  try {
    const value = BigInt(raw);
    const unit = 10n ** BigInt(decimals);
    return Number(value / unit) + Number(value % unit) / Number(unit);
  } catch {
    return null;
  }
}

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function usd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}
