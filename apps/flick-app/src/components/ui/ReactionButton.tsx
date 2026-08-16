'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from './Icon';

interface ReactionButtonProps {
  active: boolean;
  icon: IconName;
  activeIcon: IconName;
  label: string;
  activeLabel?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** Shows the text label under the button (the player rail wants this;
   *  the movie detail action bar, which already labels itself, doesn't). */
  showLabel?: boolean;
  size?: number;
}

/**
 * Like/bookmark toggle shared by the player rail and the movie detail
 * action bar, so both get the same modernized treatment: a glass circle
 * with an accent ring when active, a spring bounce on the icon, and a
 * single radiating ring pulse the moment it's activated — the one
 * deliberate flourish in the app (docs/FRONTEND_PLAN.md Part 4 Tier 3,
 * "the like burst"). Pure CSS, no motion library needed.
 */
export function ReactionButton({
  active,
  icon,
  activeIcon,
  label,
  activeLabel,
  onClick,
  disabled = false,
  showLabel = false,
  size = 44,
}: ReactionButtonProps) {
  const [burst, setBurst] = useState(false);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) {
      setBurst(true);
      const timer = window.setTimeout(() => setBurst(false), 550);
      wasActive.current = active;
      return () => window.clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active]);

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={active ? (activeLabel ?? label) : label}
        aria-pressed={active}
        style={{ width: size, height: size }}
        className={`relative flex items-center justify-center rounded-full border backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-150 active:scale-90 disabled:opacity-50
          ${
            active
              ? 'border-brand-ink/40 bg-brand text-white shadow-[0_0_18px_-2px_rgba(204,51,0,0.7)]'
              : 'border-white/15 bg-black/45 text-white hover:bg-black/60'
          }`}
      >
        {burst && (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-reaction-ring rounded-full border-2 border-brand-ink"
          />
        )}
        <Icon
          name={active ? activeIcon : icon}
          size={Math.round(size * 0.45)}
          className={burst ? 'animate-reaction-pop' : ''}
        />
      </button>
      {showLabel && (
        <span className="text-xs text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
          {label}
        </span>
      )}
    </div>
  );
}
