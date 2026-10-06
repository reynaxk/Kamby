import Link from 'next/link';
import { KambyLogo } from '@/components/layout/KambyLogo';

/** kamby-void here — same real gap as app/error.tsx (see that file's own comment): this
 *  boundary runs inside the root layout, which already has Tailwind/void tokens loaded, so
 *  there's no structural reason for it to fall back to the light theme. Restyled 2026-10-06 to
 *  match the landing page (it was a lone box with no logo or way back into the app). */
export default function NotFound() {
  return (
    <div className="kamby-void kamby-landing flex min-h-screen flex-col bg-[#05070A] text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-6">
        <Link href="/" aria-label="Kamby home" className="flex items-center gap-2">
          <KambyLogo />
        </Link>
      </header>
      <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.3em] text-[#3D7A58]">404</p>
        <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">This page doesn&apos;t exist.</h1>
        <p className="mt-3 font-body text-sm text-[#94A3B8]">The coin or page you followed may have moved. The market hasn&apos;t.</p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/terminal"
            className="rounded-xl bg-[#00FF87] px-8 py-3.5 font-display text-sm font-bold text-black shadow-[0_0_28px_rgba(0,255,135,0.45)] transition-shadow hover:shadow-[0_0_44px_rgba(0,255,135,0.75)]"
          >
            Go Trade
          </Link>
          <Link href="/" className="rounded-xl border border-white/15 bg-white/[0.04] px-7 py-3.5 font-display text-sm font-bold text-white transition-colors hover:bg-white/[0.08]">
            Back home
          </Link>
        </div>
      </main>
    </div>
  );
}
