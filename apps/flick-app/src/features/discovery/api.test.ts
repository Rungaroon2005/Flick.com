import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFits } from './api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => vi.restoreAllMocks());

const validItem = {
  movie: { id: 'm1', title: 'M', description: 'D', genres: [] },
  episode: { id: 'e1', title: 'E', isPremium: false, sceneMarkers: [] },
  kind: 'first_episode',
  runtimeMinutes: 20,
  finishesAtHint: '2026-09-05T22:07:00.000Z',
};

describe('fetchFits', () => {
  it('requests the whitelisted maxMinutes as a query param', async () => {
    const spy = respond(200, [validItem]);
    await fetchFits(30);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/discovery/fits?maxMinutes=30'),
      expect.anything(),
    );
  });

  it('decodes a well-formed response into FitsItem[]', async () => {
    respond(200, [validItem]);
    await expect(fetchFits(30)).resolves.toMatchObject([{ kind: 'first_episode' }]);
  });

  it('rejects a malformed response rather than handing bad data to UI code', async () => {
    respond(200, [{ ...validItem, kind: 'director_cut' }]);
    await expect(fetchFits(30)).rejects.toThrow();
  });
});
