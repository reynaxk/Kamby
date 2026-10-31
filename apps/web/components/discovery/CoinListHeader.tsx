/** The column titles over a wide list — only shown where the row shows the columns too. */
export function CoinListHeader({ labels }: { labels: { coin: string; mc: string; vol: string; liq: string; price: string } }) {
  return (
    <div className="kamby-coin-row border-b border-line/60 max-md:hidden">
      <div className="kamby-coin-head items-center gap-2.5 px-2.5 py-1.5 font-mono text-[0.62rem] uppercase tracking-wider text-ink-400">
        <span className="flex-1 pl-[2.875rem]">{labels.coin}</span>
        <span className="w-[4.75rem] text-right">{labels.mc}</span>
        <span className="w-[4.75rem] text-right">{labels.vol}</span>
        <span className="w-[4.75rem] text-right">{labels.liq}</span>
        <span className="w-[44px]" aria-hidden />
        <span className="w-[5.5rem] text-right">{labels.price}</span>
        <span className="w-[3.25rem]" aria-hidden />
      </div>
    </div>
  );
}
