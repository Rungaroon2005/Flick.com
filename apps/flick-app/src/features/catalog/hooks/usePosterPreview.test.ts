import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_STOP_MS, HOLD_MS, movedPastThreshold, usePosterPreview } from './usePosterPreview';
import * as reducedMotion from '@/lib/prefersReducedMotion';

vi.mock('@/lib/prefersReducedMotion', () => ({
  prefersReducedMotion: vi.fn(() => false),
}));

const TRAILER_URL = '/videos/movie1-preview.m4v';

describe('movedPastThreshold', () => {
  it('is false for a small jitter', () => {
    expect(movedPastThreshold({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(false);
  });

  it('is true past the 10px threshold', () => {
    expect(movedPastThreshold({ x: 0, y: 0 }, { x: 11, y: 0 })).toBe(true);
  });
});

describe('usePosterPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(reducedMotion.prefersReducedMotion).mockReturnValue(false);
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: false },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not preview immediately on touch pointerdown -- only after the hold threshold', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    expect(result.current.previewing).toBe(false);
  });

  it('starts previewing once the hold threshold elapses', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(true);
  });

  it('cancels the hold if the finger moves past 10px before the threshold', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => result.current.handlers.onPointerMove({ pointerType: 'touch', clientX: 20, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(false);
  });

  it('stops previewing on pointerup', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    act(() => result.current.handlers.onPointerUp({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    expect(result.current.previewing).toBe(false);
  });

  it('auto-stops after 10 seconds even if the hold continues', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(true);
    act(() => vi.advanceTimersByTime(AUTO_STOP_MS));
    expect(result.current.previewing).toBe(false);
  });

  it('suppresses the click that follows a completed hold', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => result.current.handlers.onClickCapture({ preventDefault, stopPropagation }));
    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not suppress a plain tap that never held long enough to preview', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => result.current.handlers.onPointerUp({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    act(() => result.current.handlers.onClickCapture({ preventDefault, stopPropagation }));
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ignores mouse pointerdown -- desktop uses hover-intent, not long-press', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'mouse', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(false);
  });

  it('previews on mouse hover after the intent delay', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerEnter({ pointerType: 'mouse', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(true);
  });

  it('cancels the hover intent on pointerleave before the delay elapses', () => {
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerEnter({ pointerType: 'mouse', clientX: 0, clientY: 0 }));
    act(() => result.current.handlers.onPointerLeave({ pointerType: 'mouse', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(false);
  });

  it('never previews when there is no trailerUrl', () => {
    const { result } = renderHook(() => usePosterPreview(null));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(false);
  });

  it('respects prefers-reduced-motion by never starting playback', () => {
    vi.mocked(reducedMotion.prefersReducedMotion).mockReturnValue(true);
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(false);
  });

  it('respects navigator.connection.saveData by never starting playback', () => {
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    });
    const { result } = renderHook(() => usePosterPreview(TRAILER_URL));
    act(() => result.current.handlers.onPointerDown({ pointerType: 'touch', clientX: 0, clientY: 0 }));
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(result.current.previewing).toBe(false);
  });
});
