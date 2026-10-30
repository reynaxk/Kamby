import { cn } from '@kamby/ui';
import { SafeImg } from '@/components/social/SafeImg';
import { KambyPfp } from '@/components/social/KambyPfp';

export const AVATAR_GRADIENTS = [
  'from-[#00FF87] to-[#00B4D8]',
  'from-[#A78BFA] to-[#6366F1]',
  'from-[#F472B6] to-[#FB923C]',
  'from-[#38BDF8] to-[#2563EB]',
  'from-[#FACC15] to-[#F97316]',
];

/** A person: their picture, or Kamby's default — the K in a colour picked from their name
 *  (2026-10-30, owner; it was their initials on a gradient). */
export function DmAvatar({ name, src, className }: { name: string | null; src: string | null; className?: string }) {
  return <SafeImg src={src} className={cn('h-12 w-12 shrink-0 rounded-full object-cover', className)} fallback={<KambyPfp seedKey={name ?? '?'} className={className} />} />;
}
