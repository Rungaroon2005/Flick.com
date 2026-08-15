'use client';

import { useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';

/**
 * Was missing entirely before this (docs/FRONTEND_PLAN.md Phase 2) — an
 * uncaught render error fell through to Next's unstyled default overlay.
 * `unstable_retry` re-fetches and re-renders the boundary's children; it's
 * the current recommended recovery over the older `reset()` (verified
 * against this Next 16.2.12 install's own docs — the API changed).
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
      <Icon name="alertCircle" size={40} className="text-fail" />
      <div>
        <p className="text-title font-display">เกิดข้อผิดพลาดบางอย่าง</p>
        <p className="mt-2 text-sm text-fg-dim">กรุณาลองใหม่อีกครั้ง</p>
      </div>
      <Button variant="secondary" onClick={() => unstable_retry()} className="mt-2">
        <Icon name="refresh" size={16} />
        ลองใหม่
      </Button>
    </div>
  );
}
