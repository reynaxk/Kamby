import { Skeleton } from '@/components/market/Skeleton';

/**
 * `/trader/[address]` has real server-side data fetching (`await fetchTraderProfile(...)`
 * in the page component) but is NOT `kamby-void`-themed, unlike its two siblings that share
 * the root `app/loading.tsx` fallback (`/` and `/leaderboard`, both Void). Without this
 * dedicated file, this route would inherit that now-Void fallback and flash black before
 * settling back to its own light/dark palette — the same bug in reverse. Kept deliberately
 * simple (a handful of generic blocks, not a pixel-exact match of every stat tile) — this
 * is a bug fix for a color mismatch, not a redesign of the loading experience.
 */
export default function TraderProfileLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      <Skeleton className="mt-6 h-56 w-full rounded-2xl" />
    </div>
  );
}
