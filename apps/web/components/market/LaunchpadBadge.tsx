import { cn } from '@kamby/ui';
import { launchpadFor } from '@/lib/launchpad';

/** A small "Pump.fun" / "four.meme" / … tag showing where the coin launched; nothing when unknown. */
export function LaunchpadBadge({ chain, address, className }: { chain: string; address: string; className?: string }) {
  const pad = launchpadFor(chain, address);
  if (!pad) return null;
  return (
    <span
      title={`Launched on ${pad.name}`}
      className={cn('inline-block rounded border px-1 py-px font-mono text-[0.55rem] font-semibold uppercase leading-tight tracking-wide', pad.className, className)}
    >
      {pad.name}
    </span>
  );
}
