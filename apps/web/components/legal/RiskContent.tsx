import Link from 'next/link';

/** The Risk disclosure text — rendered by /risk and by LegalModal, so there is one copy. */
export function RiskContent() {
  return (
    <>
      <p>
        Trading crypto assets is high risk. You can lose all of the money you put in. Read this before
        you trade on Kamby.
      </p>

      <section>
        <h2>Most tokens listed here are not vetted</h2>
        <p>
          Kamby lists some tokens automatically: when a new trading pool appears on a supported chain and
          holds at least a minimum amount of liquidity, it can show up in Markets, Trending, Movers and
          Volume without any human review. A listing is <strong>not</strong> an endorsement. Automatically
          listed tokens may be scams, &quot;honeypots&quot; you can buy but not sell, or projects whose
          creators remove liquidity without warning. Trading activity and volume figures can be inflated
          by bots.
        </p>
      </section>

      <section>
        <h2>Prices move fast and trades are final</h2>
        <ul>
          <li>Prices can change sharply between seeing a quote and your trade confirming.</li>
          <li>Your slippage setting limits how much worse a fill can be; a trade that would exceed it fails.</li>
          <li>Blockchain transactions cannot be reversed. Kamby cannot undo, cancel or refund a trade.</li>
          <li>Network fees (gas) are charged even when a transaction fails.</li>
        </ul>
      </section>

      <section>
        <h2>You hold your own keys</h2>
        <p>
          Kamby is non-custodial: your wallet is controlled by you (directly, or through an embedded wallet
          provided by Privy), and Kamby never holds your funds. That also means nobody at Kamby can recover
          lost access or reverse a transfer you signed.
        </p>
      </section>

      <section>
        <h2>Third-party and technical risk</h2>
        <p>
          Trades route through third-party protocols (for example KyberSwap on EVM chains and Jupiter on
          Solana), pool contracts, and RPC providers. Any of these can fail, be exploited, or return bad
          data. Market data may be delayed or incomplete.
        </p>
      </section>

      <section>
        <h2>Numbers on Kamby are informational</h2>
        <p>
          Profit and loss, leaderboards, trending rankings and trader statistics only reflect activity
          Kamby can observe (PnL covers trades placed through Kamby only), may contain errors, and are not
          predictions or advice. Nothing on Kamby is investment, financial, legal or tax advice.
        </p>
      </section>

      <p>
        See also the <Link href="/terms" className="text-accent hover:underline">Terms of Service</Link>.
      </p>
    </>
  );
}
