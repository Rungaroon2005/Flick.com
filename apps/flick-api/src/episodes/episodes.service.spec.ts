import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EpisodesService } from './episodes.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('EpisodesService', () => {
  let service: EpisodesService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EpisodesService>(EpisodesService);
  });

  /** The shape Prisma returns for the service's include tree. */
  const episodeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'e1',
    seasonId: 's1',
    episodeNumber: 2,
    title: 'ตอนที่ 2',
    description: 'desc',
    videoUrl: 'SHOULD-NOT-LEAK',
    thumbnailUrl: '/thumb.jpg',
    durationMinutes: 10,
    isPremium: true,
    releaseDate: new Date('2026-01-01'),
    season: {
      id: 's1',
      movieId: 'm1',
      seasonNumber: 1,
      movie: {
        id: 'm1',
        title: 'สาธุ',
        description: 'movie desc',
        posterUrl: '/poster.jpg',
        year: 2026,
        contentRating: 'ทั่วไป',
        genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }],
      },
    },
    ...overrides,
  });

  it('returns the episode alongside its parent movie', async () => {
    prisma.episode.findFirst.mockResolvedValue(episodeRow());

    const result = await service.findOne('e1');

    expect(result.episode).toMatchObject({
      id: 'e1',
      title: 'ตอนที่ 2',
      durationMinutes: 10,
      isPremium: true,
    });
    expect(result.movie).toMatchObject({ id: 'm1', title: 'สาธุ' });
  });

  // The same rule MoviesService.toDto enforces: videoUrl is reachable ONLY
  // through GET /playback/:episodeId/authorize. A non-null value is used here
  // so this test can tell "the key was deleted" apart from "the key was
  // always null".
  it('never returns videoUrl (deletes the key, not just nulls it)', async () => {
    prisma.episode.findFirst.mockResolvedValue(episodeRow());

    const result = await service.findOne('e1');

    expect(result.episode).not.toHaveProperty('videoUrl');
    expect(JSON.stringify(result)).not.toContain('SHOULD-NOT-LEAK');
  });

  it('does not nest the season/movie back inside the episode', async () => {
    prisma.episode.findFirst.mockResolvedValue(episodeRow());

    const result = await service.findOne('e1');

    // `season` carried the movie in the query; it must not survive into the
    // response, or the movie ships twice and `episode.season.movie` becomes a
    // second, unstripped path to the same data.
    expect(result.episode).not.toHaveProperty('season');
  });

  it('flattens the movie genres onto the wire shape', async () => {
    prisma.episode.findFirst.mockResolvedValue(episodeRow());

    const result = await service.findOne('e1');

    expect(result.movie.genres).toEqual([
      { id: 'g1', name: 'ดราม่า', slug: 'drama' },
    ]);
  });

  it('passes scene markers through, alongside the stripped videoUrl', async () => {
    const markers = [
      {
        id: 'sm1',
        episodeId: 'e1',
        kind: 'INTRO',
        startSeconds: 0,
        endSeconds: 30,
      },
    ];
    prisma.episode.findFirst.mockResolvedValue(
      episodeRow({ sceneMarkers: markers }),
    );

    const result = await service.findOne('e1');

    expect(result.episode).toMatchObject({ sceneMarkers: markers });
  });

  it('throws NotFoundException when the episode does not exist', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('requires the episode to belong to a published, non-deleted movie', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);

    await expect(service.findOne('hidden')).rejects.toThrow(NotFoundException);
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'hidden',
          deletedAt: null,
          season: {
            movie: { status: 'PUBLISHED', deletedAt: null },
          },
        },
      }),
    );
  });
});
