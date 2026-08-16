import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * Encodes the Cinnabar contrast rule so it can't be reached for wrong:
 * `primary` fills with --color-brand (5.20:1 with white text on top);
 * it never sets brand as a text color on a dark ground, which measures
 * 4.04:1 and fails AA (docs/FRONTEND_PLAN.md Part 1).
 */
const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand text-white shadow-lg shadow-black/25 hover:bg-brand-deep hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand-ink/20 active:translate-y-0 active:scale-95',
  secondary:
    'bg-ink-2 text-fg shadow-md shadow-black/20 hover:bg-hairline hover:-translate-y-0.5 active:translate-y-0 active:scale-95',
  ghost: 'bg-transparent text-fg-dim hover:text-fg active:scale-95',
  danger: 'bg-fail/15 text-fail hover:bg-fail/25 active:scale-95',
};

const sizeClasses: Record<Size, string> = {
  md: 'h-11 px-6 text-sm',
  lg: 'h-13 px-7 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', loading = false, disabled, className = '', children, ...rest },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded-full font-medium
          transition-all duration-300 ease-out
          disabled:opacity-45 disabled:pointer-events-none disabled:hover:translate-y-0
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink
          ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...rest}
      >
        {loading && <Icon name="spinner" size={16} className="animate-spin" />}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
