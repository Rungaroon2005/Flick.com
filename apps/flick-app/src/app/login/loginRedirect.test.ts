import { describe, expect, it } from 'vitest';
import { resolveLoginDestination } from './loginRedirect';

describe('resolveLoginDestination', () => {
  it('sends a returning user to their destination', () => {
    expect(resolveLoginDestination('/player/ep-1', false)).toBe('/player/ep-1');
  });

  it('sends a returning user home when there is no destination', () => {
    expect(resolveLoginDestination(null, false)).toBe('/home');
  });

  // A new account still meets plan selection — but the episode they came
  // for rides along, so /subscribe is a step rather than a dead end.
  it('sends a new user to plan selection carrying the destination', () => {
    expect(resolveLoginDestination('/player/ep-1', true)).toBe(
      '/subscribe?next=%2Fplayer%2Fep-1',
    );
  });

  it('sends a new user to bare plan selection when there is no destination', () => {
    expect(resolveLoginDestination(null, true)).toBe('/subscribe');
  });

  it('never trusts an off-origin destination', () => {
    expect(resolveLoginDestination('https://evil.com', false)).toBe('/home');
    expect(resolveLoginDestination('//evil.com', true)).toBe('/subscribe');
  });
});
