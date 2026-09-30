import { notFound } from 'next/navigation';
import { LegalPage } from '@/components/legal/LegalPage';
import { RiskContent } from '@/components/legal/RiskContent';
import { LEGAL_DETAILS_CONFIRMED } from '@/lib/legal';

// While unpublished, the not-found screen below renders under this route — don't let its
// title (or a crawler) treat it as the real document.
export const metadata = LEGAL_DETAILS_CONFIRMED
  ? { title: 'Risk disclosure — Kamby' }
  : { title: 'Page not found — Kamby', robots: { index: false, follow: false } };

export default function Page() {
  // Not published until the operator details in lib/legal.ts are real — see its doc comment.
  if (!LEGAL_DETAILS_CONFIRMED) notFound();
  return (
    <LegalPage title="Risk disclosure">
      <RiskContent />
    </LegalPage>
  );
}
