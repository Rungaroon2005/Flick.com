import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './prefersReducedMotion';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('prefersReducedMotion', () => {
  it('is false by default in the test environment', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reflects a true matchMedia result', () => {
    // jsdom doesn't implement matchMedia at all, so there's nothing for
    // vi.spyOn to attach to -- assigning it directly is the mock here.
    window.matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('queries the standard prefers-reduced-motion media feature', () => {
    const spy = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
    window.matchMedia = spy;
    prefersReducedMotion();
    expect(spy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('does not throw when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    // @ts-expect-error -- simulating an environment without matchMedia
    delete window.matchMedia;
    expect(() => prefersReducedMotion()).not.toThrow();
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = original;
  });
});
