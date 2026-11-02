import type { ReactNode } from 'react';
import { cn } from '@kamby/ui';

/**
 * One idea per screen (2026-11-02, owner: "slowly introduce Kamby — not too much info"): a number,
 * a big line, one sentence, and the live scene. The scene rises into place as you scroll
 * (.kl-rise, CSS scroll-driven — never hidden: browsers without it simply show it still).
 */
export function StorySection({
  n,
  title,
  body,
  art,
  flip = false,
  tone,
}: {
  n: string;
  title: string;
  body: string;
  art: ReactNode;
  flip?: boolean;
  tone: string;
}) {
  return (
    <section className="mx-auto grid min-h-[78vh] max-w-6xl items-center gap-10 px-5 py-20 lg:grid-cols-2 lg:gap-20">
      <div className={cn('kl-rise text-center lg:text-left', flip && 'lg:order-2')}>
        <span className="font-mono text-sm font-semibold tracking-[0.2em]" style={{ color: tone }}>
          {n}
        </span>
        <h2 className="mt-4 font-display text-[clamp(2.4rem,5.5vw,4rem)] font-black leading-[1.02] tracking-tight text-white">{title}</h2>
        <p className="mx-auto mt-5 max-w-md font-body text-lg leading-relaxed text-[#8B94A3] lg:mx-0">{body}</p>
      </div>
      <div className={cn('kl-rise-slow relative flex justify-center', flip && 'lg:order-1')}>
        <div className="relative flex min-h-[400px] w-full max-w-[460px] items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[#07090C] px-6 sm:min-h-[440px]">
          <div className="relative mb-20 mt-4 w-full max-w-[400px]">{art}</div>
        </div>
      </div>
    </section>
  );
}
