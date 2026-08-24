import { describe, expect, it } from 'vitest';
import { safeNext, withNext } from './nextParam';

describe('safeNext', () => {
  // These are the whole point of the module: `next` arrives in a URL a
  // stranger can send you, so anything that could leave the origin is
  // rejected rather than sanitised.
  it.each([
    ['//evil.com', 'protocol-relative'],
    ['https://evil.com', 'absolute https'],
    ['http://evil.com', 'absolute http'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['/\\evil.com', 'backslash-smuggled host'],
    ['home', 'no leading slash'],
    ['', 'empty'],
  ])('rejects %s (%s)', (raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it.each([
    ['/\t/evil.com', 'tab-smuggled protocol-relative'],
    ['/\n/evil.com', 'newline-smuggled protocol-relative'],
    ['/\r/evil.com', 'carriage-return-smuggled protocol-relative'],
    ['/\t\\evil.com', 'tab plus backslash'],
  ])('rejects %j (%s)', (raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it.each([null, undefined])('rejects %s', (raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it('accepts an in-app path', () => {
    expect(safeNext('/player/ep-1')).toBe('/player/ep-1');
  });

  it('keeps a query string and hash on an in-app path', () => {
    expect(safeNext('/movie/42?season=2#ep3')).toBe('/movie/42?season=2#ep3');
  });
});

describe('withNext', () => {
  it('appends an encoded next', () => {
    expect(withNext('/login', '/player/ep-1')).toBe('/login?next=%2Fplayer%2Fep-1');
  });

  it('returns the bare base when next is unusable', () => {
    expect(withNext('/login', '//evil.com')).toBe('/login');
    expect(withNext('/login', null)).toBe('/login');
  });

  // /subscribe already carries next when the gate sends you there; adding a
  // second one would produce ?next=a&next=b and URLSearchParams.get would
  // silently pick the first.
  it('replaces an existing next rather than appending a second', () => {
    expect(withNext('/subscribe?next=%2Fold', '/new')).toBe('/subscribe?next=%2Fnew');
  });
});
