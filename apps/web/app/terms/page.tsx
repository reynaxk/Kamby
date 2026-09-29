import Link from 'next/link';
import { LegalPage } from '@/components/legal/LegalPage';
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from '@/lib/legal';

export const metadata = { title: 'Terms of Service — Kamby' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern your use of Kamby (kambesh.com), operated by {LEGAL_ENTITY} (&quot;we&quot;,
        &quot;us&quot;). By using Kamby you agree to them. If you don&apos;t agree, don&apos;t use Kamby.
      </p>

      <section>
        <h2>1. Who can use Kamby</h2>
        <p>
          You must be at least 18 and legally able to enter into these terms. You may not use Kamby where
          doing so is prohibited by the laws that apply to you, including sanctions laws. You are
          responsible for any taxes on your trades.
        </p>
      </section>

      <section>
        <h2>2. What Kamby is</h2>
        <p>
          Kamby is a non-custodial interface for discovering tokens and trading them on public blockchains.
          We never hold your funds or your private keys. Trades are executed by third-party protocols and
          settled on-chain by transactions that you sign. We are not a broker, exchange, or financial
          adviser.
        </p>
      </section>

      <section>
        <h2>3. Token listings</h2>
        <p>
          Some tokens are listed automatically based on on-chain liquidity, without review. A listing is not
          an endorsement, recommendation, or statement that a token is safe or legitimate. Read the{' '}
          <Link href="/risk" className="text-accent hover:underline">risk disclosure</Link>.
        </p>
      </section>

      <section>
        <h2>4. Fees</h2>
        <p>
          We charge a platform fee on trades. The exact fee for a trade is shown in the review step before
          you confirm it. Network fees (gas) are paid to the blockchain, not to us, and apply even if a
          transaction fails. Referral rewards are paid out of our own fee, never added on top of yours, and
          are paid manually at our discretion.
        </p>
      </section>

      <section>
        <h2>5. Your account and content</h2>
        <p>
          You are responsible for your wallet and login. Usernames, avatars, theses and other content you
          add are public; don&apos;t post anything unlawful, misleading, infringing, or that impersonates
          someone else. We may remove content or restrict accounts that break these terms.
        </p>
      </section>

      <section>
        <h2>6. Things you may not do</h2>
        <ul>
          <li>Manipulate markets, rankings or leaderboards (including wash trading or fake activity).</li>
          <li>Interfere with, overload, or try to gain unauthorized access to Kamby.</li>
          <li>Use Kamby for fraud, money laundering, or to evade sanctions.</li>
        </ul>
      </section>

      <section>
        <h2>7. No warranties</h2>
        <p>
          Kamby is provided &quot;as is&quot;. Prices, market data, statistics and quotes may be delayed,
          incomplete, or wrong, and the service may be unavailable. We do not guarantee any trade will
          execute or at what price.
        </p>
      </section>

      <section>
        <h2>8. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, we are not liable for trading losses, lost profits, losses
          caused by third-party protocols, smart contracts, wallets, blockchains or tokens, or for indirect
          or consequential losses. Nothing in these terms limits liability that cannot be limited by law.
        </p>
      </section>

      <section>
        <h2>9. Changes</h2>
        <p>
          We may update these terms. The &quot;last updated&quot; date above will change, and continued use
          means you accept the updated terms.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-accent hover:underline">{LEGAL_CONTACT_EMAIL}</a>
        </p>
      </section>
    </LegalPage>
  );
}
