'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';

/** NewPlan C2's own numbers -- not tunable, so no config surface. */
export const HOLD_MS = 400;
export const MOVE_CANCEL_PX = 10;
export const AUTO_STOP_MS = 10_000;

export interface PointerLike {
  pointerType: string;
  clientX: number;
  clientY: number;
}

export function movedPastThreshold(
  start: { x: number; y: number },
  point: { x: number; y: number },
): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) > MOVE_CANCEL_PX;
}

function saveDataEnabled(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return nav.connection?.saveData === true;
}

/**
 * Press-and-hold (touch) / hover-intent (mouse) trailer preview for a
 * MovieCard poster (NewPlan C2). Reads Movie.trailerUrl directly and never
 * calls /playback/:id/authorize -- a preview is marketing, not entitled
 * content, and routing it through the authorize endpoint would let anyone
 * without a subscription pull a real playable video URL through it.
 *
 * Touch cancels the hold the instant the finger moves more than
 * MOVE_CANCEL_PX -- without this, holding a finger still long enough to
 * trigger a preview would also fight the shelf's horizontal scroll, the
 * app's primary browsing gesture. Mouse has no such conflict, so desktop
 * uses hover-intent (the same delay, entered on pointerenter) instead of
 * requiring a press.
 */
export function usePosterPreview(trailerUrl: string | null | undefined) {
  const [previewing, setPreviewing] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClick = useRef(false);
  const eligible = Boolean(trailerUrl);

  const clearHoldTimer = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  // Stable identity (only refs and a setState setter inside) so the
  // unmount-cleanup effect below can list it as a dependency honestly,
  // rather than needing an exhaustive-deps suppression.
  const stopPreview = useCallback(() => {
    clearHoldTimer();
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }
    setPreviewing(false);
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  const startPreview = () => {
    // A reduced-motion or data-saver visitor still sees the same static
    // poster this hook would otherwise replace with video -- there is no
    // separate "still frame" asset to swap to, so simply not starting
    // playback already satisfies "แสดงภาพนิ่ง".
    if (!eligible || prefersReducedMotion() || saveDataEnabled()) return;
    setPreviewing(true);
    autoStopTimer.current = setTimeout(stopPreview, AUTO_STOP_MS);
  };

  const onPointerDown = (e: PointerLike) => {
    if (e.pointerType !== 'touch' || !eligible) return;
    startPos.current = { x: e.clientX, y: e.clientY };
    clearHoldTimer();
    holdTimer.current = setTimeout(() => {
      suppressNextClick.current = true;
      startPreview();
    }, HOLD_MS);
  };

  const onPointerMove = (e: PointerLike) => {
    if (e.pointerType !== 'touch' || !startPos.current) return;
    if (movedPastThreshold(startPos.current, { x: e.clientX, y: e.clientY })) {
      clearHoldTimer();
    }
  };

  const onPointerUp = (e: PointerLike) => {
    if (e.pointerType !== 'touch') return;
    startPos.current = null;
    stopPreview();
  };

  const onPointerEnter = (e: PointerLike) => {
    if (e.pointerType !== 'mouse' || !eligible) return;
    clearHoldTimer();
    holdTimer.current = setTimeout(startPreview, HOLD_MS);
  };

  const onPointerLeave = (e: PointerLike) => {
    if (e.pointerType !== 'mouse') return;
    stopPreview();
  };

  // A hold that actually triggered a preview shouldn't also fire the
  // Link's navigation on release -- that's Peek & Pop, not a tap.
  const onClickCapture = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    if (!suppressNextClick.current) return;
    suppressNextClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    previewing,
    stop: stopPreview,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerEnter,
      onPointerLeave,
      onClickCapture,
    },
  };
}
