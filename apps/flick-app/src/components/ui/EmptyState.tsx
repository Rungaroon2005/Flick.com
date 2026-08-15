import Link from 'next/link';
import { Icon, IconName } from './Icon';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description?: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
}

/**
 * One outline icon, a title, a guidance line, a text button — no bespoke
 * illustrations. Every empty state names one thing the user can do next
 * (docs/FRONTEND_PLAN.md Part 3): a dead end is a bug.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Icon name={icon} size={32} className="text-fg-mute" />
      <p className="text-base font-medium text-fg">{title}</p>
      {description && <p className="max-w-xs text-sm text-fg-dim">{description}</p>}
      {action &&
        ('href' in action ? (
          <Link href={action.href} className="mt-1 text-sm font-medium text-brand-ink">
            {action.label}
          </Link>
        ) : (
          <button onClick={action.onClick} className="mt-1 text-sm font-medium text-brand-ink">
            {action.label}
          </button>
        ))}
    </div>
  );
}
