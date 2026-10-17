import { cn } from '@kamby/ui';

const GRADIENTS = [
  'from-[#00FF87] to-[#00B4D8]',
  'from-[#A78BFA] to-[#6366F1]',
  'from-[#F472B6] to-[#FB923C]',
  'from-[#38BDF8] to-[#2563EB]',
  'from-[#FACC15] to-[#F97316]',
];

/** A person in private messages: their picture, or their initials on a gradient picked from
 *  their name (the same person always gets the same colours). */
export function DmAvatar({ name, src, className }: { name: string | null; src: string | null; className?: string }) {
  const label = name ?? '?';
  const seed = Array.from(label).reduce((n, c) => n + c.charCodeAt(0), 0);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- user avatars come from anywhere
    return <img src={src} alt="" className={cn('h-12 w-12 shrink-0 rounded-full object-cover', className)} />;
  }
  return (
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-display text-base font-black text-black', GRADIENTS[seed % GRADIENTS.length], className)} aria-hidden>
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
