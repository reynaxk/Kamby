/** A solid lightning bolt in the button's ink (crisper than the ⚡ emoji on neon). */
export function Bolt({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M13.2 2 4.6 13.4a.6.6 0 0 0 .5 1h5.6l-1.2 7.1c-.1.6.7.9 1.1.4l8.6-11.4a.6.6 0 0 0-.5-1h-5.6l1.2-7.1c.1-.6-.7-.9-1.1-.4Z" />
    </svg>
  );
}
