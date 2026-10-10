import { CoinScreenSkeleton } from '@/components/market/CoinScreenSkeleton';
import RootLoading from '../loading';

/** A coin opening: its phone screen's shape below lg, the generic skeleton on desktop. */
export default function SolanaLoading() {
  return (
    <>
      <div className="lg:hidden">
        <CoinScreenSkeleton />
      </div>
      <div className="max-lg:hidden">
        <RootLoading />
      </div>
    </>
  );
}
