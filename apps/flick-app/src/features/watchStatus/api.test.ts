import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWatchStatus, mergeWatchStatus } from './api';
import type { Movie, WatchStatusResponse } from '@/types';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => vi.restoreAllMocks());

function movie(id: string): Movie {
  return { id, title: `Movie ${id}`, description: 'D', genres: [] } as unknown as Movie;
}

describe('fetchWatchStatus', () => {
  it('requests the given movieIds as a comma-separated query param', async () => {
    const spy = respond(200, { m1: { state: 'none', percent: 0, lastWatchedAt: null } });
    await fetchWatchStatus(['m1', 'm2']);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/me/watch-status?movieIds=m1,m2'),
      expect.anything(),
    );
  });

  it('rejects a malformed response rather than handing bad data to UI code', async () => {
    respond(200, { m1: { state: 'somehow-watched', percent: 0, lastWatchedAt: null } });
    await expect(fetchWatchStatus(['m1'])).rejects.toThrow();
  });
});

describe('mergeWatchStatus', () => {
  it('attaches the matching status entry to each movie', () => {
    const status: WatchStatusResponse = {
      m1: { state: 'watched', percent: 100, lastWatchedAt: '2026-01-01T00:00:00.000Z' },
    };
    const [merged] = mergeWatchStatus([movie('m1')], status);
    expect(merged.watchStatus).toEqual(status.m1);
  });

  it("defaults to 'none' for a movie the status response has nothing for", () => {
    const [merged] = mergeWatchStatus([movie('m2')], {});
    expect(merged.watchStatus).toEqual({ state: 'none', percent: 0, lastWatchedAt: null });
  });

  it('never mutates the original movie objects', () => {
    const original = movie('m1');
    mergeWatchStatus([original], {});
    expect(original).not.toHaveProperty('watchStatus');
  });

  it('is a pure client-side join -- it never calls fetch itself', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    mergeWatchStatus([movie('m1')], { m1: { state: 'watched', percent: 100, lastWatchedAt: null } });
    expect(spy).not.toHaveBeenCalled();
  });
});
