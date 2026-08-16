'use client';

import { useEffect, useState } from 'react';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import { Icon } from './Icon';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Hides the header row (title + close button) for content that draws its own. */
  hideHeader?: boolean;
}

/**
 * Bottom sheet — the paywall gate and player settings both read as a drawer
 * over content the user is still connected to, rather than an interruption
 * (docs/FRONTEND_PLAN.md Part 3). Focus trap, Escape, and scroll lock come
 * from the existing useModalDismiss hook; only the animation is new.
 */
export function Sheet({ open, onClose, title, children, hideHeader = false }: SheetProps) {
  const [entered, setEntered] = useState(false);
  const dialogRef = useModalDismiss<HTMLDivElement>(onClose, open);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    // Resets on close (and on unmount) so the next open re-animates from
    // translate-y-full instead of skipping straight to entered.
    return () => {
      cancelAnimationFrame(raf);
      setEntered(false);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-30 flex items-end justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300
        ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className={`w-full max-w-lg rounded-t-3xl border-t border-white/10 bg-ink-1/95 p-7 pb-safe
          shadow-[0_-16px_60px_-12px_rgba(0,0,0,0.7)] backdrop-blur-2xl
          transition-transform duration-300 ease-out
          ${entered ? 'translate-y-0' : 'translate-y-full'}`}
        onClick={(event) => event.stopPropagation()}
      >
        {!hideHeader && (
          <div className="mb-6 flex items-center justify-between">
            <h3 id="sheet-title" className="text-title font-display">
              {title}
            </h3>
            <button
              onClick={onClose}
              aria-label="ปิด"
              data-modal-close
              className="flex h-9 w-9 items-center justify-center rounded-full text-fg-dim transition-all duration-300 ease-out hover:bg-white/5 hover:text-fg active:scale-90"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
