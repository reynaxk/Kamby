import { notFound } from 'next/navigation';
import { LegalPage } from '@/components/legal/LegalPage';
import { RiskContent } from '@/components/legal/RiskContent';
import { LEGAL_DETAILS_CONFIRMED } from '@/lib/legal';

export const metadata = { title: 'Risk disclosure — Kamby' };

export default function Page() {
  // Not published until the operator details in lib/legal.ts are real — see its doc comment.
  if (!LEGAL_DETAILS_CONFIRMED) notFound();
  return (
    <LegalPage title="Risk disclosure">
      <RiskContent />
    </LegalPage>
  );
}
