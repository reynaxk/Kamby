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
import { WhatsNew } from '@/components/home/WhatsNew';
import { InstallApp } from '@/components/pwa/InstallApp';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { CallProvider } from '@/components/calls/CallProvider';
import { SessionGuard } from '@/components/account/SessionGuard';
import { ChatPulse } from '@/components/dm/ChatPulse';
import { LandingOnlyOnPhones } from '@/components/layout/LandingOnlyOnPhones';
import { LaunchOnHome } from '@/components/pwa/LaunchOnHome';
import { AppSplash, SPLASH_GATE_SCRIPT } from '@/components/pwa/AppSplash';
import { AUTH_GATE_SCRIPT, AuthGate } from '@/components/auth/AuthGate';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/** Phone status bar and browser chrome in Kamby's background colour (installed app included). */
// maximumScale 1: iOS Safari zoomed into every small text field on tap and stayed zoomed
// (owner, 2026-10-13 — "the user gotta zoom out with fingers"). iOS still lets people pinch-zoom
// for accessibility; it only stops the automatic zoom-on-focus.
export const viewport: Viewport = { themeColor: '#05070A', width: 'device-width', initialScale: 1, maximumScale: 1 };

/** iPhone screens (CSS px wide, tall, pixel ratio) — keep in step with scripts/gen-logo.cjs. */
const IPHONE_LAUNCH_SCREENS: [number, number, number][] = [
  [440, 956, 3], [430, 932, 3], [402, 874, 3], [393, 852, 3], [390, 844, 3],
  [428, 926, 3], [414, 896, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2],
];

export const metadata: Metadata = {
  // Required for the OG/Twitter image URLs Next.js builds from icon.png/opengraph-image.png
  // to resolve to a real, publicly-reachable address — without this, Next defaults to
  // http://localhost:3000, which is exactly what every crawler (Twitter, Discord, Slack,
  // iMessage) would try and fail to fetch. Confirmed live 2026-09-15: this is precisely
  // what shipped on the first deploy of these images, silently defeating the whole point.
  metadataBase: new URL('https://kambesh.com'),
  title: 'Kamby',
  description: 'The social terminal for trading — find coins, follow whales and chat with traders, all with USDC.',
  // Installable app (see app/manifest.ts): full-screen on iPhone home screens too.
  appleWebApp: {
    capable: true,
    title: 'Kamby',
    statusBarStyle: 'black-translucent',
    // iOS launch screens — the bare neon K on black, like Robinhood's and Phantom's (owner,
    // 2026-10-13); also what stops the white flash before the app paints. Made by
    // scripts/gen-logo.cjs, one per iPhone size.
    startupImage: IPHONE_LAUNCH_SCREENS.map(([w, h, dpr]) => ({
      url: `/brand/startup/kamby-${w * dpr}x${h * dpr}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
    })),
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${manrope.variable} ${jetbrainsMono.variable}`} style={{ backgroundColor: '#05070A', colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        {/* Dark from the very first paint (2026-10-13: the app opened on a white page — the
            light :root theme showed until a .kamby-void screen streamed in). */}
        <meta name="color-scheme" content="dark" />
        {/* Decides before first paint whether the launch splash shows — see AppSplash. */}
        <script dangerouslySetInnerHTML={{ __html: SPLASH_GATE_SCRIPT }} />
        {/* Decides before first paint whether the sign-in wall shows — see AuthGate. */}
        <script dangerouslySetInnerHTML={{ __html: AUTH_GATE_SCRIPT }} />
      </head>
      <body className="kamby-void font-body antialiased">
        <AppSplash />
        <NextIntlClientProvider locale={locale} messages={messages}>
        <Providers>
          <CallProvider>
          <div id="kamby-app">
          {/* Bottom space for what's fixed there: the phone tab bar (h-16 + safe area) on phones,
              the TickerBar (h-8) from md up when it's switched on — so neither covers the end of the page. */}
          <div className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-[var(--ticker-h)]">
            {children}
            <LandingOnlyOnPhones>
              <SiteFooter />
            </LandingOnlyOnPhones>
          </div>
          <TickerBar />
          <MobileTabBar />
          </div>
          </CallProvider>
          <AuthGate />
          <SessionGuard />
          <ChatPulse />
          <WhatsNew />
        </Providers>
        <InstallApp />
        <LaunchOnHome />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
