import { describe, expect, it } from 'vitest';
import { PREFS_STORAGE_KEY } from './prefs';
import { NIGHT_BOOT_SCRIPT } from './bootScript';

/** Runs the literal script string the way the inline <script> tag would. */
function runBootScript(storedValue: string | null) {
  document.documentElement.removeAttribute('data-night');
  const getItem = storedValue === null ? () => null : () => storedValue;
  const fn = new Function(
    'localStorage',
    'document',
    `${NIGHT_BOOT_SCRIPT}; return document.documentElement.getAttribute('data-night');`,
  );
  return fn({ getItem }, document) as string | null;
}

describe('NIGHT_BOOT_SCRIPT', () => {
  it('reads the same storage key prefs.ts writes to', () => {
    // The single source of truth is PREFS_STORAGE_KEY. If this script ever
    // hard-codes a different literal, it silently stops reacting to
    // savePrefs() and this is the only place that would catch it.
    expect(NIGHT_BOOT_SCRIPT).toContain(PREFS_STORAGE_KEY);
  });

  it('sets data-night=on when the stored prefs say night: true', () => {
    expect(runBootScript(JSON.stringify({ night: true }))).toBe('on');
  });

  it('sets no attribute when the stored prefs say night: false', () => {
    expect(runBootScript(JSON.stringify({ night: false }))).toBeNull();
  });

  it('sets no attribute when nothing is stored', () => {
    expect(runBootScript(null)).toBeNull();
  });

  it('sets no attribute for corrupt JSON, and does not throw', () => {
    expect(() => runBootScript('{not json')).not.toThrow();
    expect(runBootScript('{not json')).toBeNull();
  });

  it('sets no attribute when localStorage.getItem itself throws', () => {
    document.documentElement.removeAttribute('data-night');
    const fn = new Function(
      'localStorage',
      'document',
      `${NIGHT_BOOT_SCRIPT}; return document.documentElement.getAttribute('data-night');`,
    );
    const throwingStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => fn(throwingStorage, document)).not.toThrow();
    expect(fn(throwingStorage, document)).toBeNull();
  });
});
