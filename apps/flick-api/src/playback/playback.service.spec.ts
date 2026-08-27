import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { PrismaService } from '../prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let subscriptions: { hasActiveSubscription: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    subscriptions = { hasActiveSubscription: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybackService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();

    service = module.get<PlaybackService>(PlaybackService);
  });

  it('allows a free episode without touching subscription', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: false,
    });
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: true,
      reason: 'free',
      videoUrl: 'u',
    });
    expect(subscriptions.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it('never leaks videoUrl when access is denied', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'SECRET',
      isPremium: true,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(false);
    const result = await service.authorize('u1', 'e1');
    expect(result.allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('lets an active subscriber watch a premium episode', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: true,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(true);
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: true,
      reason: 'subscription',
      videoUrl: 'u',
    });
  });

  it('denies with subscription_required when the episode is premium and not subscribed', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: true,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(false);
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: false,
      reason: 'subscription_required',
    });
  });

  it('throws NotFoundException when the episode does not exist', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.authorize('u1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('requires the episode to belong to a published, non-deleted movie', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);

    await expect(service.authorize('u1', 'hidden')).rejects.toThrow(
      NotFoundException,
    );
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

  it('throws ServiceUnavailableException when access is allowed but videoUrl is null', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: null,
      isPremium: false,
    });
    await expect(service.authorize('u1', 'e1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
