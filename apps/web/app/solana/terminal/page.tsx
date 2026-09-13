import { ToastProvider } from '@/components/terminal/ToastProvider';
import { KambyTerminal } from '@/components/terminal/KambyTerminal';

export const metadata = { title: 'Terminal preview — Kamby' };

/**
 * Layout/design preview of the full 3-column DEX terminal — see PreviewBanner.tsx and
 * KambyTerminal.tsx's own doc comments for exactly what's mock vs. real here. Deliberately
 * a separate route from `/solana` (the real, working trade flow) rather than a replacement
 * for it — this page exists to finish visual/layout design work ahead of the backend
 * (trending tokens, price history, position tracking) it will eventually need, not to ship
 * as-is.
 */
export default function SolanaTerminalPreviewPage() {
  return (
    <ToastProvider>
      <div className="kamby-terminal bg-bg">
        <KambyTerminal />
      </div>
    </ToastProvider>
  );
}
