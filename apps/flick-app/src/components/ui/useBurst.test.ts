import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBurst } from './useBurst';

describe('useBurst', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not fire on the initial render, even when already active', () => {
    const { result } = renderHook(() => useBurst(true));
    expect(result.current).toBe(false);
  });

  it('fires on the transition into active', () => {
    const { result, rerender } = renderHook(({ a }) => useBurst(a), {
      initialProps: { a: false },
    });
    rerender({ a: true });
    expect(result.current).toBe(true);
  });

  it('clears itself after the animation window', () => {
    const { result, rerender } = renderHook(({ a }) => useBurst(a), {
      initialProps: { a: false },
    });
    rerender({ a: true });
    expect(result.current).toBe(true);

    act(() => void vi.advanceTimersByTime(600));
    expect(result.current).toBe(false);
  });

  it('does not fire on the transition OUT of active', () => {
    const { result, rerender } = renderHook(({ a }) => useBurst(a), {
      initialProps: { a: true },
    });
    rerender({ a: false });
    expect(result.current).toBe(false);
  });
});
