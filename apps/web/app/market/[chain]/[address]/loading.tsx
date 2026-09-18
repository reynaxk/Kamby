import { Skeleton } from '@/components/market/Skeleton';

/** `/market/[chain]/[address]` is always `kamby-void`-themed (see that page's own doc
 *  comment) — this fallback previously wasn't, so every cold load of a token page flashed
 *  the light/system-dark background for a beat before the real page mounted and re-skinned
 *  it. Unlike the root `app/loading.tsx`, this one is unambiguous: it's dedicated to this
 *  one route, never shared with a non-Void sibling. */
export default function TokenLoading() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 flex items-center gap-4">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="mt-6 h-9 w-48" />
        <div className="mt-6 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-8 h-72 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
