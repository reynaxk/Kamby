import { LegalPage } from '@/components/legal/LegalPage';
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY } from '@/lib/legal';

export const metadata = { title: 'Privacy Policy — Kamby' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what {LEGAL_ENTITY} (&quot;we&quot;) collects when you use Kamby, why, and what
        you can do about it.
      </p>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Wallet addresses</strong> you connect or verify, and the trades you place through Kamby.</li>
          <li><strong>Profile details</strong> you choose to add: username and profile picture.</li>
          <li><strong>Activity on Kamby:</strong> follows, likes, watchlists, saved searches, theses you post, notification settings, and referral relationships.</li>
          <li><strong>Technical data:</strong> IP address and request details in our server logs, used for security and debugging.</li>
        </ul>
        <p>
          We do not store your email address or run identity checks. When you sign in with email or Google,
          that login is handled by our authentication provider, Privy, under its own privacy policy.
        </p>
      </section>

      <section>
        <h2>Public by nature</h2>
        <p>
          Blockchain transactions are public. Anyone can see trades made from a wallet address, whether or
          not they use Kamby. Your username, profile picture, public profile, leaderboard position and
          theses are also visible to others on Kamby.
        </p>
      </section>

      <section>
        <h2>Why we use it</h2>
        <p>
          To run Kamby: sign you in, show quotes and execute trades you request, show your history, profit
          and loss and notifications, operate the referral program, and keep the service secure. We do not
          sell your data.
        </p>
      </section>

      <section>
        <h2>Service providers</h2>
        <p>
          We rely on providers to operate Kamby, including Privy (sign-in and embedded wallets), Cloudflare
          (website hosting and image storage), Railway (servers and database), blockchain RPC providers,
          and trade routers such as KyberSwap and Jupiter, which receive the details needed to quote a
          trade you request.
        </p>
      </section>

      <section>
        <h2>Your browser</h2>
        <p>
          Kamby stores your session in your browser&apos;s local storage so you stay signed in. We don&apos;t
          use advertising trackers.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          You can ask us to access, correct, or delete the data we hold about you by emailing{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-accent hover:underline">{LEGAL_CONTACT_EMAIL}</a>.
          We can delete what&apos;s stored in Kamby&apos;s own systems, but not transactions already recorded
          on a public blockchain.
        </p>
      </section>
    </LegalPage>
  );
}
