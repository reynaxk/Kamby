import { FlaskConical } from 'lucide-react';

/**
 * A permanent, un-dismissable banner on the KambyTerminal layout preview — most of this
 * page is mock data (trending list, chart, positions, caller alpha), built to finish the
 * visual/layout design before the backend behind it exists. It stays on screen the whole
 * time a viewer is on this page specifically so nobody — including future us, at 3am,
 * months from now — mistakes a mock position or a mock caller alert for a real one. The
 * real, working trade flow lives at `/solana`, linked directly rather than just named.
 */
export function PreviewBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2 font-mono text-xs text-warn">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      <span>
        <strong className="font-semibold">Layout preview</strong> — trending tokens, chart, positions, and caller
        alpha below are mock data, not live. Real trading is at{' '}
        <a href="/solana" className="underline hover:text-warn/80">
          /solana
        </a>
        .
      </span>
    </div>
  );
}
