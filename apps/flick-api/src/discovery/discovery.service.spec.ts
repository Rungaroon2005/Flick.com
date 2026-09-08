import { DiscoveryService } from './discovery.service';
import { MoviesService, type MovieDto } from '../movies/movies.service';
import { EngagementService } from '../engagement/engagement.service';

describe('DiscoveryService', () => {
  let movies: { findAll: jest.Mock };
  let engagement: { getContinueWatching: jest.Mock };
  let service: DiscoveryService;

  beforeEach(() => {
    movies = { findAll: jest.fn().mockResolvedValue([]) };
    engagement = { getContinueWatching: jest.fn().mockResolvedValue([]) };
    service = new DiscoveryService(
      movies as unknown as MoviesService,
      engagement as unknown as EngagementService,
    );
  });

  function movie(overrides: Record<string, unknown> = {}): MovieDto {
    return {
      id: 'm1',
      title: 'M',
      genres: [],
      seasons: [],
      ...overrides,
    } as unknown as MovieDto;
  }

  function episode(overrides: Record<string, unknown> = {}) {
    return {
      id: 'e1',
      seasonId: 's1',
      episodeNumber: 1,
      title: 'E1',
      durationMinutes: 20,
      sceneMarkers: [],
      ...overrides,
    };
  }

  it('returns nothing when the catalogue is empty and nothing is in progress', async () => {
    await expect(service.fits('u1', 30)).resolves.toEqual([]);
  });

  describe('mood filter', () => {
    it('includes only catalogue movies tagged with the requested mood', async () => {
      movies.findAll.mockResolvedValue([
        movie({
          id: 'm1',
          moods: [{ id: 'md1', slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' }],
          seasons: [{ id: 's1', episodes: [episode()] }],
        }),
        movie({
          id: 'm2',
          moods: [{ id: 'md2', slug: 'cry', name: 'อยากร้องไห้', emoji: '😢' }],
          seasons: [{ id: 's1', episodes: [episode()] }],
        }),
      ]);

      const items = await service.fits('u1', 30, 'thrill');

      expect(items).toHaveLength(1);
      expect(items[0].movie).toMatchObject({ id: 'm1' });
    });

    it('excludes an untagged movie from a mood-filtered result', async () => {
      movies.findAll.mockResolvedValue([
        movie({
          id: 'm1',
          moods: [],
          seasons: [{ id: 's1', episodes: [episode()] }],
        }),
      ]);

      await expect(service.fits('u1', 30, 'thrill')).resolves.toEqual([]);
    });

    it('also filters in-progress (next_episode) items by mood', async () => {
      const taggedMovie = movie({
        id: 'm1',
        moods: [{ id: 'md1', slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' }],
      });
      const untaggedMovie = movie({ id: 'm2', moods: [] });
      engagement.getContinueWatching.mockResolvedValue([
        {
          progressSeconds: 60,
          episode: episode({ durationMinutes: 20 }),
          movie: taggedMovie,
        },
        {
          progressSeconds: 60,
          episode: episode({ durationMinutes: 20 }),
          movie: untaggedMovie,
        },
      ]);

      const items = await service.fits('u1', 30, 'thrill');

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: 'next_episode',
        movie: { id: 'm1' },
      });
    });

    it('with no mood argument, applies no mood filter at all', async () => {
      movies.findAll.mockResolvedValue([
        movie({
          id: 'm1',
          moods: [],
          seasons: [{ id: 's1', episodes: [episode()] }],
        }),
      ]);

      const items = await service.fits('u1', 30);

      expect(items).toHaveLength(1);
    });

    it('an unrecognized mood slug yields an empty result, not an error', async () => {
      movies.findAll.mockResolvedValue([
        movie({
          id: 'm1',
          moods: [{ id: 'md1', slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' }],
          seasons: [{ id: 's1', episodes: [episode()] }],
        }),
      ]);

      await expect(service.fits('u1', 30, 'no-such-mood')).resolves.toEqual([]);
    });
  });

  describe('film / first_episode (from the catalogue)', () => {
    it("labels a single-episode movie 'film'", async () => {
      movies.findAll.mockResolvedValue([
        movie({ id: 'm1', seasons: [{ id: 's1', episodes: [episode()] }] }),
      ]);
      const [item] = await service.fits('u1', 30);
      expect(item).toMatchObject({ kind: 'film', movie: { id: 'm1' } });
    });

    it("labels a multi-episode movie's first episode 'first_episode'", async () => {
      movies.findAll.mockResolvedValue([
        movie({
          id: 'm1',
          seasons: [
            {
              id: 's1',
              episodes: [
                episode({ id: 'e1' }),
                episode({ id: 'e2', episodeNumber: 2 }),
              ],
            },
          ],
        }),
      ]);
      const [item] = await service.fits('u1', 30);
      expect(item).toMatchObject({
        kind: 'first_episode',
        episode: { id: 'e1' },
      });
    });

    it('excludes a movie whose first episode does not fit maxMinutes', async () => {
      movies.findAll.mockResolvedValue([
        movie({
          seasons: [{ id: 's1', episodes: [episode({ durationMinutes: 90 })] }],
        }),
      ]);
      await expect(service.fits('u1', 15)).resolves.toEqual([]);
    });

    it('subtracts skippable marker time from runtimeMinutes, rounded up', async () => {
      movies.findAll.mockResolvedValue([
        movie({
          seasons: [
            {
              id: 's1',
              episodes: [
                episode({
                  durationMinutes: 30,
                  sceneMarkers: [{ startSeconds: 0, endSeconds: 90 }], // 90s = 1.5min
                }),
              ],
            },
          ],
        }),
      ]);
      const [item] = await service.fits('u1', 30);
      // 30min - 1.5min = 28.5min, rounded up to 29.
      expect(item.runtimeMinutes).toBe(29);
    });

    it('skips a movie with no episodes at all rather than throwing', async () => {
      movies.findAll.mockResolvedValue([
        movie({ seasons: [{ id: 's1', episodes: [] }] }),
      ]);
      await expect(service.fits('u1', 30)).resolves.toEqual([]);
    });
  });

  describe('next_episode (from continue-watching)', () => {
    it("labels an in-progress episode 'next_episode', using remaining time", async () => {
      engagement.getContinueWatching.mockResolvedValue([
        {
          progressSeconds: 600, // 10 min in
          episode: episode({ durationMinutes: 20 }), // 20 min total -> 10 min left
          movie: movie({ id: 'm1' }),
        },
      ]);
      const [item] = await service.fits('u1', 30);
      expect(item).toMatchObject({ kind: 'next_episode', runtimeMinutes: 10 });
    });

    it('excludes an in-progress episode whose remaining time does not fit', async () => {
      engagement.getContinueWatching.mockResolvedValue([
        {
          progressSeconds: 60,
          episode: episode({ durationMinutes: 90 }), // 89 min left
          movie: movie({ id: 'm1' }),
        },
      ]);
      await expect(service.fits('u1', 15)).resolves.toEqual([]);
    });

    it('a movie already covered by next_episode is not ALSO offered as first_episode', async () => {
      const m1 = movie({
        id: 'm1',
        seasons: [
          {
            id: 's1',
            episodes: [
              episode({ id: 'e1' }),
              episode({ id: 'e2', episodeNumber: 2 }),
            ],
          },
        ],
      });
      movies.findAll.mockResolvedValue([m1]);
      engagement.getContinueWatching.mockResolvedValue([
        {
          progressSeconds: 60,
          episode: episode({ id: 'e2', durationMinutes: 20 }),
          movie: m1,
        },
      ]);
      const items = await service.fits('u1', 30);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: 'next_episode',
        episode: { id: 'e2' },
      });
    });

    it('never reports negative runtime when remaining is less than skippable time', async () => {
      engagement.getContinueWatching.mockResolvedValue([
        {
          progressSeconds: 1150, // 19m10s in, 50s of a 20-minute episode left
          episode: episode({
            durationMinutes: 20,
            sceneMarkers: [{ startSeconds: 0, endSeconds: 600 }], // 10 min skippable, far exceeds 50s left
          }),
          movie: movie({ id: 'm1' }),
        },
      ]);
      const [item] = await service.fits('u1', 90);
      expect(item.runtimeMinutes).toBe(0);
    });
  });

  it('sets finishesAtHint to an ISO timestamp roughly runtimeMinutes from now', async () => {
    movies.findAll.mockResolvedValue([
      movie({
        seasons: [{ id: 's1', episodes: [episode({ durationMinutes: 15 })] }],
      }),
    ]);
    const before = Date.now();
    const [item] = await service.fits('u1', 30);
    const hint = new Date(item.finishesAtHint).getTime();
    expect(hint).toBeGreaterThanOrEqual(before + 15 * 60_000 - 2000);
    expect(hint).toBeLessThanOrEqual(before + 15 * 60_000 + 2000);
  });
});
