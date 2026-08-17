import { describe, expect, it } from 'vitest';
import { decodeApiResponse, decodeMovies, decodePlans } from './api';

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
    expect(() => decodePlans({ subscriptions: {}, coins: [] })).toThrow('collections');
  });
});
