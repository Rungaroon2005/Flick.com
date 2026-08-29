// apps/flick-app/src/components/ui/Toast.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';

const AUTO_DISMISS_MS = 4000;

interface Toast {
  id: number;
  message: string;
}

interface ToastApi {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * One feedback channel for the whole app. Specified in FRONTEND_PLAN.md
 * Part 3 and never built, which is why the player's notice could sit over
 * a scene for the rest of an episode.
 *
 * A queue rather than a single slot: a like/bookmark action that fails and
 * a playback warning can land in the same second, and dropping one of them
 * is how a user ends up not knowing why nothing happened.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string) => {
    setToasts((current) => [...current, { id: Date.now() + current.length, message }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((current) => current.slice(1)), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-28 z-[200] flex flex-col items-center gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-fade-in-up pointer-events-auto flex max-w-sm items-center gap-2 rounded-2xl border border-white/10 bg-ink-1/95 px-4 py-3 text-sm text-fg shadow-surface backdrop-blur-xl"
          >
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              aria-label="ปิด"
              className="focus-ring shrink-0 rounded-full p-1 text-fg-mute transition-colors duration-ui hover:text-fg"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
