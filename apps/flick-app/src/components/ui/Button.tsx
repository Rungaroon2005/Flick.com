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
  primary: 'bg-brand text-white hover:bg-brand-deep active:scale-95',
  secondary: 'bg-ink-2 text-fg hover:bg-hairline active:scale-95',
  ghost: 'bg-transparent text-fg-dim hover:text-fg active:scale-95',
  danger: 'bg-fail/15 text-fail hover:bg-fail/25 active:scale-95',
};

const sizeClasses: Record<Size, string> = {
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-6 text-base',
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
        className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium
          transition-[background-color,transform] duration-100
          disabled:opacity-45 disabled:pointer-events-none
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
