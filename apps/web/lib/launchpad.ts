/**
 * Where a coin launched (user request 2026-10-07, "show where every coin launched — its
 * launchpad"). Read from the address itself: these launchpads mint vanity addresses with a
 * fixed ending, so no API call is needed and every list row can show it. Only endings that
 * are reliably theirs are listed; any other coin gets no badge rather than a guess.
 */
export interface Launchpad {
  name: string;
  /** Badge text and colour classes. */
  className: string;
}

const SOLANA: { suffix: string; pad: Launchpad }[] = [
  { suffix: 'pump', pad: { name: 'Pump.fun', className: 'border-[#53D18F]/40 bg-[#53D18F]/10 text-[#53D18F]' } },
  { suffix: 'bonk', pad: { name: 'LetsBonk', className: 'border-[#F7931A]/40 bg-[#F7931A]/10 text-[#F7931A]' } },
  { suffix: 'BAGS', pad: { name: 'Bags', className: 'border-[#A78BFA]/40 bg-[#A78BFA]/10 text-[#A78BFA]' } },
];
const BNB: { suffix: string; pad: Launchpad }[] = [
  { suffix: '4444', pad: { name: 'four.meme', className: 'border-[#F0B90B]/40 bg-[#F0B90B]/10 text-[#F0B90B]' } },
];
const BASE: { suffix: string; pad: Launchpad }[] = [
  { suffix: 'b07', pad: { name: 'Clanker', className: 'border-[#8B5CF6]/40 bg-[#8B5CF6]/10 text-[#8B5CF6]' } },
];

export function launchpadFor(chainIdentifier: string, address: string): Launchpad | null {
  const chain = chainIdentifier.toLowerCase();
  if (chain === 'solana') return SOLANA.find((l) => address.endsWith(l.suffix))?.pad ?? null;
  const lower = address.toLowerCase();
  if (chain.includes('bnb') || chain.includes('bsc') || chain === '56' || chain.endsWith(':56')) {
    return BNB.find((l) => lower.endsWith(l.suffix))?.pad ?? null;
  }
  if (chain.includes('base') || chain === '8453' || chain.endsWith(':8453')) {
    return BASE.find((l) => lower.endsWith(l.suffix.toLowerCase()))?.pad ?? null;
  }
  return null;
}
