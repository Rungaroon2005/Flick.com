import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NIGHT_SUGGESTION_KEY,
  hasBeenSuggested,
  isNightHour,
  markSuggested,
} from './nightSuggestionStorage';

afterEach(() => {
  window.localStorage.clear();
});

describe('isNightHour', () => {
  it.each([22, 23, 0, 1, 4])('treats hour %i as night', (hour) => {
    expect(isNightHour(hour)).toBe(true);
  });

  it.each([5, 6, 12, 18, 21])('treats hour %i as not night', (hour) => {
    expect(isNightHour(hour)).toBe(false);
  });
});

describe('hasBeenSuggested / markSuggested', () => {
  it('has not been suggested before markSuggested is called', () => {
    expect(hasBeenSuggested()).toBe(false);
  });

  it('is permanently true once marked -- dismissal is permanent', () => {
    markSuggested();
    expect(hasBeenSuggested()).toBe(true);
  });

  it('records a timestamp, not just a boolean flag', () => {
    markSuggested();
    const stored = window.localStorage.getItem(NIGHT_SUGGESTION_KEY);
    expect(stored).not.toBeNull();
    expect(Number.isNaN(Date.parse(stored as string))).toBe(false);
  });

  it('fails closed (treated as already suggested) when storage access throws', () => {
    // If we can't remember a dismissal reliably either, defaulting to
    // "never suggested" would nag on every load in a restricted browser.
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(hasBeenSuggested()).toBe(true);
    spy.mockRestore();
  });

  it('markSuggested does not throw when storage access throws', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => markSuggested()).not.toThrow();
    spy.mockRestore();
  });
});
