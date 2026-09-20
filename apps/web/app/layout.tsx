import type { Metadata } from 'next';
import { JetBrains_Mono, Manrope, Source_Serif_4 } from 'next/font/google';
import './globals.css';
// Importing this for its module-level side effect: it validates process.env at import
// time (see lib/env.ts), and the root layout is the one module every request loads, so
// this is where "fail fast on a bad env var" actually gets wired into the app's boot path.
import '@/lib/env';
import { OnboardingPrompt } from '@/components/account/OnboardingPrompt';
import { TickerBar } from '@/components/market/TickerBar';
import { Providers } from './providers';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Required for the OG/Twitter image URLs Next.js builds from icon.png/opengraph-image.png
  // to resolve to a real, publicly-reachable address — without this, Next defaults to
  // http://localhost:3000, which is exactly what every crawler (Twitter, Discord, Slack,
  // iMessage) would try and fail to fetch. Confirmed live 2026-09-15: this is precisely
  // what shipped on the first deploy of these images, silently defeating the whole point.
  metadataBase: new URL('https://kambesh.com'),
  title: 'Kamby',
  description: 'A social crypto discovery and trading platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}>
      <body className="font-body antialiased">
        <Providers>
          {/* pb-8 reserves the TickerBar's own h-8 so its fixed position never overlaps the
              last bit of scrolled content underneath it. */}
          <div className="pb-8">{children}</div>
          <OnboardingPrompt />
          <TickerBar />
        </Providers>
      </body>
    </html>
  );
}
