import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'buy' | 'sell';
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'bg-surface-raised text-ink-900 hover:bg-line',
  ghost: 'bg-transparent text-ink-600 hover:text-ink-900',
  // Side-aware trading actions — `up`/`down` already carry the gain/loss semantic
  // everywhere else in the product (price deltas, PnL), reused here rather than adding a
  // third color concept just for buttons.
  buy: 'bg-up text-black hover:opacity-90',
  sell: 'bg-down text-white hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold',
          'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
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
