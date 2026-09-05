import { describe, expect, it } from 'vitest';
import { decodeApiResponse, decodeEpisodeDetail, decodeFits, decodeMovies, decodePlans } from './api';

const validMovie = {
  id: 'm1',
  title: 'Movie',
  description: 'A movie',
  genres: [],
};

const validEpisode = {
  id: 'e1',
  title: 'Episode',
  isPremium: false,
  sceneMarkers: [],
};

describe('API contract decoders', () => {
  it('accepts a valid playback authorization', () => {
    expect(
      decodeApiResponse('/playback/episode-1/authorize', {
        allowed: true,
        reason: 'free',
        videoUrl: '/videos/episode-1.m4v',
      }),
    ).toMatchObject({ allowed: true, reason: 'free' });
  });

  it('rejects malformed playback authorization before UI code receives it', () => {
    expect(() =>
      decodeApiResponse('/playback/episode-1/authorize', {
        allowed: true,
        reason: 'free',
        videoUrl: 42,
      }),
    ).toThrow('videoUrl');
  });

  it('rejects malformed catalog and pricing collections', () => {
    expect(() => decodeMovies([{ id: 'movie-1', title: 'Missing fields' }])).toThrow();
    expect(() => decodePlans({ subscriptions: {} })).toThrow('collections');
  });

  it('accepts a valid checkout response', () => {
    expect(
      decodeApiResponse('/payments/checkout', {
        checkoutUrl: 'https://fake-gateway.local/checkout/intent-1',
        intentId: 'intent-1',
      }),
    ).toEqual({
      checkoutUrl: 'https://fake-gateway.local/checkout/intent-1',
      intentId: 'intent-1',
    });
  });

  it('rejects a checkout response missing required fields', () => {
    expect(() =>
      decodeApiResponse('/payments/checkout', { checkoutUrl: 'https://fake-gateway.local' }),
    ).toThrow('Invalid checkout response');
  });

  it('accepts an episode detail with an empty sceneMarkers array', () => {
    expect(() =>
      decodeEpisodeDetail({ episode: validEpisode, movie: validMovie }),
    ).not.toThrow();
  });

  it('accepts an episode detail with well-formed markers', () => {
    const detail = decodeEpisodeDetail({
      episode: {
        ...validEpisode,
        sceneMarkers: [
          { id: 'sm1', episodeId: 'e1', kind: 'INTRO', startSeconds: 0, endSeconds: 30 },
        ],
      },
      movie: validMovie,
    });
    expect(detail.episode).toMatchObject({
      sceneMarkers: [{ kind: 'INTRO', startSeconds: 0, endSeconds: 30 }],
    });
  });

  it('rejects an episode detail with a scene marker kind it does not recognize', () => {
    expect(() =>
      decodeEpisodeDetail({
        episode: {
          ...validEpisode,
          sceneMarkers: [{ kind: 'BLOOPER', startSeconds: 0, endSeconds: 30 }],
        },
        movie: validMovie,
      }),
    ).toThrow('Invalid scene marker kind');
  });

  it('rejects an episode detail with a non-numeric marker boundary', () => {
    expect(() =>
      decodeEpisodeDetail({
        episode: {
          ...validEpisode,
          sceneMarkers: [{ kind: 'INTRO', startSeconds: '0', endSeconds: 30 }],
        },
        movie: validMovie,
      }),
    ).toThrow('startSeconds');
  });

  it('rejects an episode detail whose sceneMarkers is missing entirely', () => {
    const { sceneMarkers: _omitted, ...episodeWithoutMarkers } = validEpisode;
    expect(() =>
      decodeEpisodeDetail({ episode: episodeWithoutMarkers, movie: validMovie }),
    ).toThrow('Invalid sceneMarkers');
  });

  it('accepts a well-formed fits response', () => {
    const items = decodeFits([
      {
        movie: validMovie,
        episode: validEpisode,
        kind: 'first_episode',
        runtimeMinutes: 20,
        finishesAtHint: '2026-09-05T22:07:00.000Z',
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'first_episode', runtimeMinutes: 20 });
  });

  it('rejects a fits item with an unrecognized kind', () => {
    expect(() =>
      decodeFits([
        {
          movie: validMovie,
          episode: validEpisode,
          kind: 'director_cut',
          runtimeMinutes: 20,
          finishesAtHint: '2026-09-05T22:07:00.000Z',
        },
      ]),
    ).toThrow('Invalid fits item kind');
  });

  it('rejects a fits item with a non-numeric runtimeMinutes', () => {
    expect(() =>
      decodeFits([
        {
          movie: validMovie,
          episode: validEpisode,
          kind: 'film',
          runtimeMinutes: '20',
          finishesAtHint: '2026-09-05T22:07:00.000Z',
        },
      ]),
    ).toThrow('runtimeMinutes');
  });

  it('rejects a fits item with an unparseable finishesAtHint', () => {
    expect(() =>
      decodeFits([
        {
          movie: validMovie,
          episode: validEpisode,
          kind: 'film',
          runtimeMinutes: 20,
          finishesAtHint: 'not a date',
        },
      ]),
    ).toThrow('finishesAtHint');
  });

  it('rejects a fits item whose episode carries a bad scene marker', () => {
    expect(() =>
      decodeFits([
        {
          movie: validMovie,
          episode: { ...validEpisode, sceneMarkers: [{ kind: 'BLOOPER', startSeconds: 0, endSeconds: 1 }] },
          kind: 'film',
          runtimeMinutes: 20,
          finishesAtHint: '2026-09-05T22:07:00.000Z',
        },
      ]),
    ).toThrow('Invalid scene marker kind');
  });

  it('rejects a non-array fits response', () => {
    expect(() => decodeFits({})).toThrow('Invalid fits response');
  });
});
