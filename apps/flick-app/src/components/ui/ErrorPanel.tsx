import { Icon } from './Icon';
import { Button } from './Button';

interface ErrorPanelProps {
  message: string;
  onRetry?: () => void;
}

/**
 * Inline error panel that replaces the failed region only — recovery is a
 * caller-supplied retry (typically router.refresh()), never a full page
 * reload that would discard client state (docs/FRONTEND_PLAN.md Part 3).
 */
export function ErrorPanel({ message, onRetry }: ErrorPanelProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-hairline bg-ink-1 px-6 py-10 text-center">
      <Icon name="alertCircle" size={28} className="text-fail" />
      <p className="text-sm text-fg-dim">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="md" onClick={onRetry} className="mt-1">
          <Icon name="refresh" size={16} />
          ลองใหม่
        </Button>
      )}
    </div>
  );
}
