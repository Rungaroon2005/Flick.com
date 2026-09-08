import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, PREFS_STORAGE_KEY, loadPrefs, savePrefs } from './prefs';

afterEach(() => {
  window.localStorage.clear();
});

describe('loadPrefs', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('round-trips whatever savePrefs wrote', () => {
    savePrefs({ night: true, autoplayNext: false, autoSkip: true });
    expect(loadPrefs()).toEqual({ night: true, autoplayNext: false, autoSkip: true });
  });

  it('falls back to defaults for a field of the wrong type, field by field', () => {
    window.localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ night: 'yes', autoplayNext: false, autoSkip: 1 }),
    );
    // `night` and `autoSkip` are malformed and must not leak a non-boolean
    // into state; `autoplayNext` was valid and must survive alongside them.
    expect(loadPrefs()).toEqual({
      night: DEFAULT_PREFS.night,
      autoplayNext: false,
      autoSkip: DEFAULT_PREFS.autoSkip,
    });
  });

  it('falls back to defaults for corrupt JSON', () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, '{not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('falls back to defaults for a stored non-object (e.g. a stray array)', () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('survives storage access throwing, e.g. Safari private mode', () => {
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    spy.mockRestore();
  });
});

describe('savePrefs', () => {
  it('does not throw when storage access throws', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
    spy.mockRestore();
  });
});
