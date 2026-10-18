import type { Locale } from '@/i18n/config';

/** A five-point star's polygon points. */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(2)},${(cy + rr * Math.sin(rad)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const H = (colors: string[], weights?: number[]) => {
  const w = weights ?? colors.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  let y = 0;
  return colors.map((c, i) => {
    const h = (w[i]! / total) * 20;
    const rect = <rect key={i} x="0" y={y} width="30" height={h + 0.05} fill={c} />;
    y += h;
    return rect;
  });
};

/** Each language's flag, drawn (emoji flags show as letters on Windows). */
const FLAGS: Record<Locale, React.ReactNode> = {
  bg: H(['#FFFFFF', '#00966E', '#D62612']),
  de: H(['#000000', '#DD0000', '#FFCE00']),
  ru: H(['#FFFFFF', '#0039A6', '#D52B1E']),
  id: H(['#CE1126', '#FFFFFF']),
  th: H(['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931'], [1, 1, 2, 1, 1]),
  es: H(['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1]),
  fr: (
    <>
      <rect width="10" height="20" fill="#0055A4" />
      <rect x="10" width="10" height="20" fill="#FFFFFF" />
      <rect x="20" width="10" height="20" fill="#EF4135" />
    </>
  ),
  ja: (
    <>
      <rect width="30" height="20" fill="#FFFFFF" />
      <circle cx="15" cy="10" r="5.6" fill="#BC002D" />
    </>
  ),
  zh: (
    <>
      <rect width="30" height="20" fill="#EE1C25" />
      <polygon points={star(6, 6, 3.6)} fill="#FFFF00" />
      {[
        [11, 2.4],
        [13, 4.6],
        [13, 7.6],
        [11, 9.8],
      ].map(([x, y]) => (
        <polygon key={`${x}-${y}`} points={star(x!, y!, 1.1)} fill="#FFFF00" />
      ))}
    </>
  ),
  vi: (
    <>
      <rect width="30" height="20" fill="#DA251D" />
      <polygon points={star(15, 10.4, 6)} fill="#FFFF00" />
    </>
  ),
  tr: (
    <>
      <rect width="30" height="20" fill="#E30A17" />
      <circle cx="12" cy="10" r="5" fill="#FFFFFF" />
      <circle cx="13.3" cy="10" r="4" fill="#E30A17" />
      <polygon points={star(18.2, 10, 2.2)} fill="#FFFFFF" transform="rotate(-18 18.2 10)" />
    </>
  ),
  ko: (
    <>
      <rect width="30" height="20" fill="#FFFFFF" />
      <path d="M10 10a5 5 0 0 1 10 0z" fill="#CD2E3A" />
      <path d="M10 10a5 5 0 0 0 10 0z" fill="#0047A0" />
      <circle cx="12.5" cy="10" r="2.5" fill="#CD2E3A" />
      <circle cx="17.5" cy="10" r="2.5" fill="#0047A0" />
      <g fill="#000000">
        <rect x="4" y="3.5" width="4" height="0.9" transform="rotate(-34 6 4)" />
        <rect x="22" y="3.5" width="4" height="0.9" transform="rotate(34 24 4)" />
        <rect x="4" y="15.6" width="4" height="0.9" transform="rotate(34 6 16)" />
        <rect x="22" y="15.6" width="4" height="0.9" transform="rotate(-34 24 16)" />
      </g>
    </>
  ),
  pt: (
    <>
      <rect width="30" height="20" fill="#009C3B" />
      <polygon points="15,2.5 27,10 15,17.5 3,10" fill="#FFDF00" />
      <circle cx="15" cy="10" r="4.3" fill="#002776" />
      <path d="M10.9 9.2c2.8-.8 5.6-.6 8.2.6" stroke="#FFFFFF" strokeWidth="0.8" fill="none" />
    </>
  ),
  en: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#FFFFFF" strokeWidth="4" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.4" />
      <path d="M15 0v20M0 10h30" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#C8102E" strokeWidth="3.4" />
    </>
  ),
};

/** A small flag with a fine edge, so white-heavy flags (Japan, Korea) still read on dark. */
export function Flag({ locale, className = 'h-[14px] w-[21px]' }: { locale: Locale; className?: string }) {
  return (
    <svg viewBox="0 0 30 20" className={`${className} shrink-0 overflow-hidden rounded-[3px] ring-1 ring-white/15`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {FLAGS[locale]}
    </svg>
  );
}
