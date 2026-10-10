/**
 * Mounts fresh on every screen change, so each new screen eases in on phones (2026-10-10, app
 * feel — screens used to just snap). Opacity only, and only while it plays (`backwards`): a
 * transform or a lasting opacity would make the fixed Buy/Sell and top bars position against
 * this wrapper instead of the screen.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="kamby-page-in">{children}</div>;
}
