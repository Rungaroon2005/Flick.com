import { ButtonHTMLAttributes } from 'react';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function Chip({ active = false, className = '', children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`focus-ring shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium
        transition-all duration-surface ease-enter active:scale-95
        ${
          active
            ? 'bg-brand text-ink shadow-[0_0_16px_-3px_rgba(246,131,85,0.6)]'
            : 'bg-ink-1 text-fg-dim hover:-translate-y-0.5 hover:text-fg'
        }
        ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
