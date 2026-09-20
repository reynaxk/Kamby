import type {
  IChartApiBase,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { SocialActivity } from '@kamby/domain';

interface MarkerPoint {
  x: number;
  y: number;
  trade: SocialActivity;
}

const RADIUS = 9;

/** Module-wide, not per-chart — KambyChart fully tears down and recreates the chart (and
 *  this primitive) on every candles/trades change, so caching by URL here is what actually
 *  avoids re-fetching the same trader's avatar on every token switch. `'error'` marks a
 *  failed load so a dead avatar URL doesn't get retried every single frame. */
const imageCache = new Map<string, HTMLImageElement | 'error'>();

function getImage(url: string, onLoad: () => void): HTMLImageElement | null {
  const cached = imageCache.get(url);
  if (cached === 'error') return null;
  if (cached) return cached.complete ? cached : null;
  const img = new Image();
  img.onload = onLoad;
  img.onerror = () => imageCache.set(url, 'error');
  img.src = url;
  imageCache.set(url, img);
  return null;
}

/**
 * A lightweight-charts v5 series primitive that draws real trader avatars directly on the
 * chart at each trade's (time, price) — the fomo.family-style look this is matching. Built-
 * in `createSeriesMarkers` only supports solid-color circle/square/arrow shapes (see
 * lightweight-charts' `SeriesMarker` type — no avatar image field), so this uses the
 * lower-level primitive API instead: `paneViews()` returns a renderer that draws on the
 * chart's own shared canvas each frame, positioned via `series.priceToCoordinate()` /
 * `chart.timeScale().timeToCoordinate()` inside `updateAllViews()`.
 *
 * Fed `trades: SocialActivity[]` — real recent large trades already available on
 * `TokenTraderConnection.recentLargeTrades` (see KambyChart's own doc comment for where
 * this comes from), each with a real `priceUsd`/`timestamp`/trader avatar. A trade whose
 * time/price has scrolled outside the chart's current visible range is simply skipped
 * (coordinate conversion returns null) rather than drawn off-canvas.
 *
 * While an avatar image is still loading, failed, or a trade has no avatarUrl at all, a
 * solid up/down-colored dot renders instead — never a blank gap, the same honesty rule
 * TraderIdentity.tsx already follows (initials instead of a fabricated placeholder image).
 */
export class ChartTraderMarkers implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private trades: SocialActivity[] = [];
  private points: MarkerPoint[] = [];
  private upColor = '#22c55e';
  private downColor = '#ef4444';

  setTrades(trades: SocialActivity[]): void {
    this.trades = trades;
    this.updateAllViews();
    this.requestUpdate?.();
  }

  setColors(upColor: string, downColor: string): void {
    this.upColor = upColor;
    this.downColor = downColor;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  updateAllViews(): void {
    if (!this.chart || !this.series) {
      this.points = [];
      return;
    }
    const timeScale = this.chart.timeScale();
    const points: MarkerPoint[] = [];
    for (const trade of this.trades) {
      const time = Math.floor(new Date(trade.timestamp).getTime() / 1000) as Time;
      const x = timeScale.timeToCoordinate(time);
      const y = this.series.priceToCoordinate(trade.priceUsd);
      if (x === null || y === null) continue;
      points.push({ x, y, trade });
    }
    this.points = points;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [
      {
        renderer: () => ({
          draw: (target) => {
            target.useMediaCoordinateSpace(({ context }) => {
              for (const { x, y, trade } of this.points) {
                this.drawMarker(context, x, y, trade);
              }
            });
          },
        }),
      },
    ];
  }

  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, trade: SocialActivity): void {
    const ringColor = trade.action === 'BUY' ? this.upColor : this.downColor;
    const avatarUrl = trade.trader.avatarUrl;
    const image = avatarUrl ? getImage(avatarUrl, () => this.requestUpdate?.()) : null;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
    ctx.closePath();
    if (image) {
      ctx.clip();
      ctx.drawImage(image, x - RADIUS, y - RADIUS, RADIUS * 2, RADIUS * 2);
    } else {
      ctx.fillStyle = ringColor;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ringColor;
    ctx.stroke();
  }
}
