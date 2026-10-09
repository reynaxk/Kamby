import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import './globals.css';
// Importing this for its module-level side effect: it validates process.env at import
// time (see lib/env.ts), and the root layout is the one module every request loads, so
// this is where "fail fast on a bad env var" actually gets wired into the app's boot path.
import '@/lib/env';
import { SiteFooter } from '@/components/legal/SiteFooter';
import { TickerBar } from '@/components/market/TickerBar';
import { Providers } from './providers';
import { InstallApp } from '@/components/pwa/InstallApp';
import { MobileTabBar } from '@/components/layout/MobileTabBar';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/** Phone status bar and browser chrome in Kamby's background colour (installed app included). */
export const viewport: Viewport = { themeColor: '#05070A' };

export const metadata: Metadata = {
  // Required for the OG/Twitter image URLs Next.js builds from icon.png/opengraph-image.png
  // to resolve to a real, publicly-reachable address — without this, Next defaults to
  // http://localhost:3000, which is exactly what every crawler (Twitter, Discord, Slack,
  // iMessage) would try and fail to fetch. Confirmed live 2026-09-15: this is precisely
  // what shipped on the first deploy of these images, silently defeating the whole point.
  metadataBase: new URL('https://kambesh.com'),
  title: 'Kamby',
  description: 'A social crypto discovery and trading platform.',
  // Installable app (see app/manifest.ts): full-screen on iPhone home screens too.
  appleWebApp: { capable: true, title: 'Kamby', statusBarStyle: 'black-translucent' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body className="font-body antialiased">
        <Providers>
          {/* Bottom space for what's fixed there: the phone tab bar (h-16 + safe area) on phones,
              the TickerBar (h-8) from md up — so neither covers the end of the page. */}
          <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-8">
            {children}
            <SiteFooter />
          </div>
          <TickerBar />
          <MobileTabBar />
        </Providers>
        <InstallApp />
      </body>
    </html>
  );
}
