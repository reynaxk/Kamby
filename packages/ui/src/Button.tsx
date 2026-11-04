import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'buy' | 'sell';
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  // text-accent-ink, not text-white — see that token's own doc comment in globals.css.
  // Under the Void theme's bright neon accent, white text is close to unreadable.
  // A soft inner shadow on solid buttons (2026-11-04 redesign): they read as pressable, not flat.
  primary: 'bg-accent text-accent-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] hover:brightness-110',
  secondary: 'border border-line bg-surface-raised text-ink-900 hover:bg-line',
  ghost: 'bg-transparent text-ink-600 hover:text-ink-900',
  // Side-aware trading actions — `up`/`down` already carry the gain/loss semantic
  // everywhere else in the product (price deltas, PnL), reused here rather than adding a
  // third color concept just for buttons.
  buy: 'bg-accent text-accent-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] hover:brightness-110',
  sell: 'bg-down text-[#1A0507] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] hover:brightness-110',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold',
          'transition active:scale-[0.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
