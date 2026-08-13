import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EngagementService } from './engagement.service';
import { PrismaService } from '../prisma.service';
import { PlaybackService } from '../playback/playback.service';
import { createPrismaMock } from '../testing/prisma.mock';

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
      { movie: { id: 'm1', title: 'A' } },
      { movie: { id: 'm2', title: 'B' } },
    ]);
    await expect(service.getBookmarks('u1')).resolves.toEqual([
      { id: 'm1', title: 'A' },
      { id: 'm2', title: 'B' },
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
          season: { movie: { id: 'm1', title: 'A' } },
        },
      },
    ]);
    const result = await service.getContinueWatching('u1');
    expect(JSON.stringify(result)).not.toContain('SECRET-URL');
    expect(result[0].episode).not.toHaveProperty('videoUrl');
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
    expect(call.where).toEqual({ userId_episodeId: { userId: 'u1', episodeId: 'e1' } });
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

  it('returns the list of downloads for a user', async () => {
    prisma.download.findMany.mockResolvedValue([{ id: 'd1' }]);
    await expect(service.getDownloads('u1')).resolves.toEqual([{ id: 'd1' }]);
    expect(prisma.download.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
  });
});
