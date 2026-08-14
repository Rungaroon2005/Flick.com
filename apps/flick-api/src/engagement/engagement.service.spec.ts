import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EngagementService } from './engagement.service';
import { PrismaService } from '../prisma.service';
import { PlaybackService } from '../playback/playback.service';
import { createPrismaMock } from '../testing/prisma.mock';
import { GENRES_INCLUDE } from '../movies/movies.service';

describe('EngagementService', () => {
  let service: EngagementService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let playback: { authorize: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    playback = { authorize: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlaybackService, useValue: playback },
      ],
    }).compile();

    service = module.get<EngagementService>(EngagementService);
  });

  // --- Bookmarks -----------------------------------------------------

  it('treats removing an absent bookmark as a successful no-op', async () => {
    prisma.bookmark.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.removeBookmark('u1', 'm1')).resolves.toEqual({
      bookmarked: false,
    });
  });

  it('adds a bookmark via an idempotent upsert on the userId_movieId key', async () => {
    prisma.bookmark.upsert.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
      movieId: 'm1',
    });
    await expect(service.addBookmark('u1', 'm1')).resolves.toEqual({
      bookmarked: true,
    });
    expect(prisma.bookmark.upsert).toHaveBeenCalledWith({
      where: { userId_movieId: { userId: 'u1', movieId: 'm1' } },
      create: { userId: 'u1', movieId: 'm1' },
      update: {},
    });
  });

  it('returns the movies behind a user bookmarks', async () => {
    prisma.bookmark.findMany.mockResolvedValue([
      { movie: { id: 'm1', title: 'A', genres: [] } },
      { movie: { id: 'm2', title: 'B', genres: [] } },
    ]);
    await expect(service.getBookmarks('u1')).resolves.toEqual([
      { id: 'm1', title: 'A', genres: [] },
      { id: 'm2', title: 'B', genres: [] },
    ]);
  });

  it('flattens the movie genre join table on bookmarked movies', async () => {
    prisma.bookmark.findMany.mockResolvedValue([
      {
        movie: {
          id: 'm1',
          title: 'A',
          genres: [
            { genre: { id: 'g1', slug: 'action', name: 'Action' } },
            { genre: { id: 'g2', slug: 'drama', name: 'Drama' } },
          ],
        },
      },
    ]);
    const result = await service.getBookmarks('u1');
    expect(result).toEqual([
      {
        id: 'm1',
        title: 'A',
        genres: [
          { id: 'g1', slug: 'action', name: 'Action' },
          { id: 'g2', slug: 'drama', name: 'Drama' },
        ],
      },
    ]);
  });

  // --- Watch history / continue watching -----------------------------

  it('derives completion from the episode duration, not from client input', async () => {
    prisma.episode.findUniqueOrThrow.mockResolvedValue({ durationMinutes: 10 });
    prisma.watchHistory.upsert.mockResolvedValue({});
    await service.updateProgress('u1', 'e1', 570); // 95% of 600s
    expect(prisma.watchHistory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ completed: true }),
      }),
    );
  });

  it('does not mark an episode completed below the 90% threshold', async () => {
    prisma.episode.findUniqueOrThrow.mockResolvedValue({ durationMinutes: 10 });
    prisma.watchHistory.upsert.mockResolvedValue({});
    await service.updateProgress('u1', 'e1', 300); // 50% of 600s
    expect(prisma.watchHistory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ completed: false }),
        update: expect.objectContaining({ completed: false }),
      }),
    );
  });

  it('queries continue-watching with completed:false, newest first, capped at 10', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([]);
    await service.getContinueWatching('u1');
    expect(prisma.watchHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', completed: false },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    );
  });

  it('never leaks episode videoUrl through continue-watching', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 42,
        episode: {
          id: 'e1',
          videoUrl: 'SECRET-URL',
          season: { movie: { id: 'm1', title: 'A', genres: [] } },
        },
      },
    ]);
    const result = await service.getContinueWatching('u1');
    expect(JSON.stringify(result)).not.toContain('SECRET-URL');
    expect(result[0].episode).not.toHaveProperty('videoUrl');
  });

  it('flattens the movie genre join table on continue-watching movies', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 42,
        episode: {
          id: 'e1',
          videoUrl: 'SECRET-URL',
          season: {
            movie: {
              id: 'm1',
              title: 'A',
              genres: [{ genre: { id: 'g1', slug: 'action', name: 'Action' } }],
            },
          },
        },
      },
    ]);
    const result = await service.getContinueWatching('u1');
    expect(result[0].movie).toEqual({
      id: 'm1',
      title: 'A',
      genres: [{ id: 'g1', slug: 'action', name: 'Action' }],
    });
  });

  // --- Downloads -------------------------------------------------------

  it('refuses to record a download for an unauthorized episode', async () => {
    playback.authorize.mockResolvedValue({
      allowed: false,
      reason: 'coins_required',
      coinCost: 10,
    });
    await expect(service.addDownload('u1', 'e1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.download.upsert).not.toHaveBeenCalled();
  });

  it('records a download via an idempotent upsert once authorized, expiring in 30 days', async () => {
    playback.authorize.mockResolvedValue({
      allowed: true,
      reason: 'free',
      videoUrl: 'u',
    });
    prisma.download.upsert.mockResolvedValue({ id: 'd1' });

    const before = Date.now();
    await service.addDownload('u1', 'e1');
    const after = Date.now();

    expect(prisma.download.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.download.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      userId_episodeId: { userId: 'u1', episodeId: 'e1' },
    });
    expect(call.create.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 24 * 60 * 60 * 1000 - 1000,
    );
    expect(call.create.expiresAt.getTime()).toBeLessThanOrEqual(
      after + 30 * 24 * 60 * 60 * 1000 + 1000,
    );
    // `update` must also refresh expiresAt (a repeat download-tap extends
    // the window rather than silently keeping the original), not be `{}`.
    expect(call.update.expiresAt).toBeInstanceOf(Date);
  });

  it('treats removing an absent download as a successful no-op', async () => {
    prisma.download.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.removeDownload('u1', 'e1')).resolves.toEqual({
      downloaded: false,
    });
  });

  it('returns download metadata without leaking the episode videoUrl', async () => {
    prisma.download.findMany.mockResolvedValue([
      {
        id: 'd1',
        episodeId: 'e1',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        episode: {
          id: 'e1',
          title: 'ตอนที่หนึ่ง',
          videoUrl: 'SECRET-URL',
          season: {
            movie: {
              id: 'm1',
              title: 'เรื่องหนึ่ง',
              posterUrl: '/poster.jpg',
              genres: [],
            },
          },
        },
      },
    ]);

    const [download] = await service.getDownloads('u1');

    expect(download.episode).not.toHaveProperty('videoUrl');
    expect(download.episode).not.toHaveProperty('season');
    expect(download.movie).toEqual({
      id: 'm1',
      title: 'เรื่องหนึ่ง',
      posterUrl: '/poster.jpg',
      genres: [],
    });
    expect(JSON.stringify(download)).not.toContain('SECRET-URL');
    expect(prisma.download.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { downloadedAt: 'desc' },
      include: {
        episode: {
          include: {
            season: {
              include: { movie: { include: { genres: GENRES_INCLUDE } } },
            },
          },
        },
      },
    });
  });
});
