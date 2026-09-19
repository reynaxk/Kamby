'use client';

import { useState } from 'react';
import { Surface } from '@kamby/ui';
import { TradePanel, type TradePanelProps, type TradePanelStep } from '@/components/trading/TradePanel';
import { SmartSlipGasBar } from './SmartSlipGasBar';

const IN_FLIGHT_STEPS: ReadonlySet<TradePanelStep> = new Set(['review', 'approving', 'signing', 'pending']);

/**
 * Thin client wrapper so the terminal's right-rail card can glow only while a trade is
 * genuinely in flight — real state-driven emphasis, not idle decoration. Kept as its own
 * small component (rather than making the whole KambyTerminal layout a Client Component)
 * so the terminal's other panels stay server-rendered.
 */
export function TradePanelCard(props: TradePanelProps) {
  const [step, setStep] = useState<TradePanelStep>('form');
  const inFlight = IN_FLIGHT_STEPS.has(step);

  return (
    <Surface className={inFlight ? 'shadow-glow-accent p-4 transition-shadow duration-300' : 'p-4 transition-shadow duration-300'}>
      <SmartSlipGasBar />
      <div className="mt-3">
        <TradePanel {...props} onStepChange={setStep} />
      </div>
    </Surface>
  );
}
