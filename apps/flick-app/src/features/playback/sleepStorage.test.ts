import { afterEach, describe, expect, it, vi } from 'vitest';
import { SLEEP_STORAGE_KEY, loadSleepState, saveSleepState } from './sleepStorage';

afterEach(() => {
  window.localStorage.clear();
});

describe('loadSleepState', () => {
  it('returns null when nothing is stored', () => {
    expect(loadSleepState()).toBeNull();
  });

  it('round-trips a timer state', () => {
    saveSleepState({ mode: 'timer', deadlineMs: 12345 });
    expect(loadSleepState()).toEqual({ mode: 'timer', deadlineMs: 12345 });
  });

  it('round-trips an end-of-episode state', () => {
    saveSleepState({ mode: 'end-of-episode' });
    expect(loadSleepState()).toEqual({ mode: 'end-of-episode' });
  });

  it('clearing persists null', () => {
    saveSleepState({ mode: 'timer', deadlineMs: 12345 });
    saveSleepState(null);
    expect(loadSleepState()).toBeNull();
  });

  it('rejects a timer entry with a non-numeric deadline', () => {
    window.localStorage.setItem(
      SLEEP_STORAGE_KEY,
      JSON.stringify({ mode: 'timer', deadlineMs: 'soon' }),
    );
    expect(loadSleepState()).toBeNull();
  });

  it('rejects an unrecognized mode', () => {
    window.localStorage.setItem(SLEEP_STORAGE_KEY, JSON.stringify({ mode: 'nap' }));
    expect(loadSleepState()).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    window.localStorage.setItem(SLEEP_STORAGE_KEY, '{not json');
    expect(loadSleepState()).toBeNull();
  });

  it('survives storage access throwing', () => {
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadSleepState()).toBeNull();
    spy.mockRestore();
  });
});

describe('saveSleepState', () => {
  it('does not throw when storage access throws', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveSleepState({ mode: 'end-of-episode' })).not.toThrow();
    spy.mockRestore();
  });
});
