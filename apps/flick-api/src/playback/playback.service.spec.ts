import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { PrismaService } from '../prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WalletService } from '../wallet/wallet.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('PlaybackService', () => {
  let service: PlaybackService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let subscriptions: { hasActiveSubscription: jest.Mock };
  let wallet: { hasUnlocked: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    subscriptions = { hasActiveSubscription: jest.fn() };
    wallet = { hasUnlocked: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybackService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: WalletService, useValue: wallet },
      ],
    }).compile();

    service = module.get<PlaybackService>(PlaybackService);
  });

  it('allows a free episode without touching subscription or wallet', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: false,
      coinCost: 0,
    });
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: true,
      reason: 'free',
      videoUrl: 'u',
    });
    expect(subscriptions.hasActiveSubscription).not.toHaveBeenCalled();
    expect(wallet.hasUnlocked).not.toHaveBeenCalled();
  });

  it('never leaks videoUrl when access is denied', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'SECRET',
      isPremium: true,
      coinCost: 10,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(false);
    wallet.hasUnlocked.mockResolvedValue(false);
    const result = await service.authorize('u1', 'e1');
    expect(result.allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('lets an active subscriber watch a premium episode', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: true,
      coinCost: 10,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(true);
    await expect(service.authorize('u1', 'e1')).resolves.toMatchObject({
      allowed: true,
      reason: 'subscription',
    });
    // Subscription already grants access — the (more expensive/relative)
    // wallet check must not run once the subscription check short-circuits.
    expect(wallet.hasUnlocked).not.toHaveBeenCalled();
  });

  it('lets a user who unlocked with coins watch, even without a subscription', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: true,
      coinCost: 10,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(false);
    wallet.hasUnlocked.mockResolvedValue(true);
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: true,
      reason: 'unlocked',
      videoUrl: 'u',
    });
  });

  it('denies with coins_required when the episode has a coin cost', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'e1',
      videoUrl: 'u',
      isPremium: true,
      coinCost: 10,
    });
    subscriptions.hasActiveSubscription.mockResolvedValue(false);
    wallet.hasUnlocked.mockResolvedValue(false);
    await expect(service.authorize('u1', 'e1')).resolves.toEqual({
      allowed: false,
      reason: 'coins_required',
      coinCost: 10,
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
      coinCost: 0,
    });
    await expect(service.authorize('u1', 'e1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
