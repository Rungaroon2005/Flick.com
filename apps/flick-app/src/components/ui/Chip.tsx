import { ButtonHTMLAttributes } from 'react';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function Chip({ active = false, className = '', children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium
        transition-colors duration-150
        ${active ? 'bg-brand text-white' : 'bg-ink-1 text-fg-dim hover:text-fg'}
        ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
