import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GENRES_INCLUDE, MoviesService } from './movies.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('MoviesService', () => {
  let service: MoviesService;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MoviesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get<MoviesService>(MoviesService);
  });

  const validDto = {
    title: 'Test',
    description: 'A test movie description',
    posterUrl: 'https://example.com/poster.jpg',
    year: 2025,
    contentRating: 'ทั่วไป',
    genreSlugs: ['drama'],
  };

  it('create calls cacheManager.del with the correct cache key', async () => {
    prismaMock.movie.create.mockResolvedValue({
      id: 'm1',
      title: 'Test',
      genres: [],
    });
    cacheManager.del.mockResolvedValue(undefined);
    await service.create(validDto);
    expect(cacheManager.del).toHaveBeenCalledWith('movies:all');
    expect(prismaMock.movie.create).toHaveBeenCalled();
  });

  it('still creates a movie when cache invalidation fails', async () => {
    prismaMock.movie.create.mockResolvedValue({ id: 'm1', genres: [] });
    cacheManager.del.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.create(validDto)).resolves.toMatchObject({ id: 'm1' });
  });

  interface CreateCallArg {
    data: {
      genres: {
        create: {
          genre: {
            connectOrCreate: {
              where: { slug: string };
              create: { slug: string; name: string };
            };
          };
        }[];
      };
    };
  }

  it('rejects a non-ISO originCountry on create with BadRequestException', async () => {
    await expect(
      service.create({ ...validDto, originCountry: 'Korea' }),
    ).rejects.toThrow(BadRequestException);
    expect(prismaMock.movie.create).not.toHaveBeenCalled();
  });

  it('normalizes originCountry to uppercase on create', async () => {
    prismaMock.movie.create.mockResolvedValue({ id: 'm1', genres: [] });
    await service.create({ ...validDto, originCountry: 'kr' });
    const [arg] = prismaMock.movie.create.mock.calls[0] as [
      { data: { originCountry?: string } },
    ];
    expect(arg.data.originCountry).toBe('KR');
  });

  describe('update', () => {
    it('calls cacheManager.del with the correct cache key', async () => {
      prismaMock.movie.update.mockResolvedValue({ id: 'm1', genres: [] });
      cacheManager.del.mockResolvedValue(undefined);
      await service.update('m1', { originCountry: 'KR' });
      expect(cacheManager.del).toHaveBeenCalledWith('movies:all');
      expect(prismaMock.movie.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { originCountry: 'KR' },
        include: { genres: GENRES_INCLUDE },
      });
    });

    it('still updates a movie when cache invalidation fails', async () => {
      prismaMock.movie.update.mockResolvedValue({ id: 'm1', genres: [] });
      cacheManager.del.mockRejectedValue(new Error('redis unavailable'));

      await expect(
        service.update('m1', { originCountry: 'KR' }),
      ).resolves.toMatchObject({ id: 'm1' });
    });

    it('normalizes originCountry to uppercase', async () => {
      prismaMock.movie.update.mockResolvedValue({ id: 'm1', genres: [] });
      await service.update('m1', { originCountry: 'jp' });
      const [arg] = prismaMock.movie.update.mock.calls[0] as [
        { data: { originCountry?: string } },
      ];
      expect(arg.data.originCountry).toBe('JP');
    });

    it('rejects a non-ISO originCountry with BadRequestException', async () => {
      await expect(
        service.update('m1', { originCountry: 'not-a-code' }),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.movie.update).not.toHaveBeenCalled();
    });

    it('translates a Prisma "record not found" error into NotFoundException', async () => {
      prismaMock.movie.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('missing', { originCountry: 'KR' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('maps genre slugs onto the MovieGenre join table', async () => {
    prismaMock.movie.create.mockResolvedValue({ genres: [] });
    await service.create({ ...validDto, genreSlugs: ['drama'] });
    const [arg] = prismaMock.movie.create.mock.calls[0] as [CreateCallArg];
    expect(arg.data).not.toHaveProperty('genreSlugs');
    expect(arg.data.genres.create[0].genre.connectOrCreate.where).toEqual({
      slug: 'drama',
    });
    expect(arg.data.genres.create[0].genre.connectOrCreate.create).toEqual({
      slug: 'drama',
      name: 'drama',
    });
  });

  it('flattens genres in the response payload', async () => {
    prismaMock.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }],
      },
    ]);
    const [movie] = await service.findAll();
    expect(movie.genres).toEqual([{ id: 'g1', name: 'ดราม่า', slug: 'drama' }]);
  });

  it('falls back to Postgres when the cache read fails', async () => {
    cacheManager.get.mockRejectedValue(new Error('redis unavailable'));
    prismaMock.movie.findMany.mockResolvedValue([{ id: 'm1', genres: [] }]);

    await expect(service.findAll()).resolves.toEqual([
      { id: 'm1', genres: [], moods: [] },
    ]);
    expect(prismaMock.movie.findMany).toHaveBeenCalled();
  });

  it('returns Postgres results when the cache write fails', async () => {
    cacheManager.get.mockResolvedValue(undefined);
    cacheManager.set.mockRejectedValue(new Error('redis unavailable'));
    prismaMock.movie.findMany.mockResolvedValue([{ id: 'm1', genres: [] }]);

    await expect(service.findAll()).resolves.toEqual([
      { id: 'm1', genres: [], moods: [] },
    ]);
  });

  it('flattens genres for findOne', async () => {
    prismaMock.movie.findFirst.mockResolvedValue({
      id: 'm1',
      genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }],
    });
    const movie = await service.findOne('m1');
    expect(movie.genres).toEqual([{ id: 'g1', name: 'ดราม่า', slug: 'drama' }]);
  });

  // Regression coverage for Task 2.5: videoUrl is the one piece of data
  // that actually lets someone watch a video, and it must be reachable
  // ONLY through GET /playback/:episodeId/authorize — never through the
  // movie/episode list endpoints. A non-null videoUrl is used here (not
  // the all-null seed-data shape) specifically so this test can tell
  // "the key was deleted" apart from "the key was always null" — the
  // whole point of the toDto fix was deleting the key, not nulling it.
  it('strips videoUrl from every episode in findAll (never just nulls it)', async () => {
    prismaMock.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [],
        seasons: [
          {
            id: 's1',
            episodes: [
              { id: 'e1', title: 'Ep 1', videoUrl: 'SHOULD-NOT-LEAK' },
            ],
          },
        ],
      },
    ]);
    const [movie] = await service.findAll();
    const [episode] = movie.seasons[0].episodes;
    expect(episode).not.toHaveProperty('videoUrl');
    expect(JSON.stringify(movie)).not.toContain('SHOULD-NOT-LEAK');
  });

  it('strips videoUrl from every episode in findOne (never just nulls it)', async () => {
    prismaMock.movie.findFirst.mockResolvedValue({
      id: 'm1',
      genres: [],
      seasons: [
        {
          id: 's1',
          episodes: [{ id: 'e1', title: 'Ep 1', videoUrl: 'SHOULD-NOT-LEAK' }],
        },
      ],
    });
    const movie = await service.findOne('m1');
    const [episode] = movie.seasons[0].episodes;
    expect(episode).not.toHaveProperty('videoUrl');
    expect(JSON.stringify(movie)).not.toContain('SHOULD-NOT-LEAK');
  });

  it('passes scene markers through findAll, alongside the stripped videoUrl', async () => {
    const markers = [
      {
        id: 'sm1',
        episodeId: 'e1',
        kind: 'INTRO',
        startSeconds: 0,
        endSeconds: 30,
      },
    ];
    prismaMock.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [],
        seasons: [
          {
            id: 's1',
            episodes: [
              {
                id: 'e1',
                title: 'Ep 1',
                videoUrl: 'SHOULD-NOT-LEAK',
                sceneMarkers: markers,
              },
            ],
          },
        ],
      },
    ]);
    const [movie] = await service.findAll();
    const [episode] = movie.seasons[0].episodes as unknown as {
      sceneMarkers: unknown;
    }[];
    expect(episode.sceneMarkers).toEqual(markers);
  });

  describe('the /movies cache invariant', () => {
    // Anything reachable through this @Public(), shared-cache response
    // must be a pure function of content state -- nothing that can differ
    // between two users. This test is the enforcement mechanism: a field
    // added anywhere in this payload without also being added to an
    // allowlist here fails the test, forcing whoever added it to
    // consciously decide "is this content, safe for every viewer, or
    // personal, and therefore wrong here" rather than have it slip in via
    // an innocuous-looking Prisma include.
    const MOVIE_KEYS = [
      'id',
      'title',
      'description',
      'posterUrl',
      'trailerUrl',
      'year',
      'contentRating',
      'status',
      'totalViews',
      'originCountry',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'genres',
      'moods',
      'seasons',
    ].sort();
    const SEASON_KEYS = [
      'id',
      'movieId',
      'seasonNumber',
      'title',
      'episodeCount',
      'createdAt',
      'updatedAt',
      'episodes',
    ].sort();
    const EPISODE_KEYS = [
      'id',
      'seasonId',
      'episodeNumber',
      'title',
      'description',
      'thumbnailUrl',
      'durationMinutes',
      'isPremium',
      'releaseDate',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'sceneMarkers',
    ].sort();
    const SCENE_MARKER_KEYS = [
      'id',
      'episodeId',
      'kind',
      'startSeconds',
      'endSeconds',
      'createdAt',
      'updatedAt',
    ].sort();
    const GENRE_KEYS = ['id', 'name', 'slug'].sort();
    const MOOD_KEYS = ['id', 'slug', 'name', 'emoji'].sort();

    it('exposes exactly the allowlisted keys at every nesting level', async () => {
      prismaMock.movie.findMany.mockResolvedValue([
        {
          id: 'm1',
          title: 'T',
          description: 'D',
          posterUrl: 'p',
          trailerUrl: null,
          year: 2025,
          contentRating: 'ทั่วไป',
          status: 'PUBLISHED',
          totalViews: 0,
          originCountry: 'KR',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          genres: [{ genre: { id: 'g1', name: 'Drama', slug: 'drama' } }],
          moods: [
            {
              mood: {
                id: 'md1',
                slug: 'thrill',
                name: 'อยากลุ้น',
                emoji: '😰',
              },
            },
          ],
          seasons: [
            {
              id: 's1',
              movieId: 'm1',
              seasonNumber: 1,
              title: 'S1',
              episodeCount: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              episodes: [
                {
                  id: 'e1',
                  seasonId: 's1',
                  episodeNumber: 1,
                  title: 'E1',
                  description: 'D',
                  videoUrl: 'SHOULD-BE-STRIPPED',
                  thumbnailUrl: 't',
                  durationMinutes: 10,
                  isPremium: false,
                  releaseDate: new Date(),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  deletedAt: null,
                  sceneMarkers: [
                    {
                      id: 'sm1',
                      episodeId: 'e1',
                      kind: 'INTRO',
                      startSeconds: 0,
                      endSeconds: 30,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);

      const [movie] = await service.findAll();

      expect(Object.keys(movie).sort()).toEqual(MOVIE_KEYS);
      expect(Object.keys(movie.genres[0]).sort()).toEqual(GENRE_KEYS);
      expect(Object.keys(movie.moods[0]).sort()).toEqual(MOOD_KEYS);
      expect(Object.keys(movie.seasons[0]).sort()).toEqual(SEASON_KEYS);
      const [episode] = movie.seasons[0].episodes as unknown as Record<
        string,
        unknown
      >[];
      expect(Object.keys(episode).sort()).toEqual(EPISODE_KEYS);
      const [marker] = episode.sceneMarkers as Record<string, unknown>[];
      expect(Object.keys(marker).sort()).toEqual(SCENE_MARKER_KEYS);
    });
  });

  it('excludes draft and soft-deleted movies from findAll', async () => {
    cacheManager.get.mockResolvedValue(undefined);
    prismaMock.movie.findMany.mockResolvedValue([]);
    await service.findAll();
    expect(prismaMock.movie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PUBLISHED', deletedAt: null },
      }),
    );
  });

  it('does not serve a draft movie by direct id', async () => {
    prismaMock.movie.findFirst.mockResolvedValue(null);
    await expect(service.findOne('draft-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('findSimilar', () => {
    it('returns movies sharing at least one genre, excluding itself', async () => {
      prismaMock.movie.findFirst.mockResolvedValue({
        id: 'm1',
        genres: [{ genreId: 'g1' }, { genreId: 'g2' }],
      });
      prismaMock.movie.findMany.mockResolvedValue([
        {
          id: 'm2',
          genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }],
          moods: [
            {
              mood: {
                id: 'md1',
                slug: 'thrill',
                name: 'อยากลุ้น',
                emoji: '😰',
              },
            },
          ],
        },
      ]);

      const result = await service.findSimilar('m1');

      expect(prismaMock.movie.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          deletedAt: null,
          id: { not: 'm1' },
          genres: { some: { genreId: { in: ['g1', 'g2'] } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          genres: { include: { genre: true } },
          moods: { include: { mood: true } },
        },
      });
      expect(result).toEqual([
        {
          id: 'm2',
          genres: [{ id: 'g1', name: 'ดราม่า', slug: 'drama' }],
          moods: [{ id: 'md1', slug: 'thrill', name: 'อยากลุ้น', emoji: '😰' }],
        },
      ]);
    });

    it('throws NotFoundException when the source movie does not exist', async () => {
      prismaMock.movie.findFirst.mockResolvedValue(null);
      await expect(service.findSimilar('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an empty array when the source movie has no genres', async () => {
      prismaMock.movie.findFirst.mockResolvedValue({ id: 'm1', genres: [] });
      const result = await service.findSimilar('m1');
      expect(result).toEqual([]);
      expect(prismaMock.movie.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll with a query', () => {
    interface FindManyCallArg {
      where?: { OR?: unknown[] };
    }

    it('filters by title, case-insensitively', async () => {
      await service.findAll('ดราม่า');
      const [arg] = prismaMock.movie.findMany.mock.calls[0] as [
        FindManyCallArg,
      ];
      expect(arg.where?.OR).toContainEqual({
        title: { contains: 'ดราม่า', mode: 'insensitive' },
      });
    });

    it('applies no where clause when the query is blank', async () => {
      await service.findAll('   ');
      const [arg] = prismaMock.movie.findMany.mock.calls[0] as [
        FindManyCallArg,
      ];
      expect(arg.where).toBeUndefined();
    });

    it('never returns videoUrl', async () => {
      prismaMock.movie.findMany.mockResolvedValue([
        {
          id: 'm1',
          genres: [],
          seasons: [
            {
              id: 's1',
              episodes: [
                { id: 'e1', title: 'Ep 1', videoUrl: 'SHOULD-NOT-LEAK' },
              ],
            },
          ],
        },
      ]);
      const result = await service.findAll('x');
      for (const movie of result) {
        expect(movie).not.toHaveProperty('videoUrl');
      }
    });
  });
});
