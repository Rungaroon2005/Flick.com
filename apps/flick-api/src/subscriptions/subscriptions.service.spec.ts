import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  beforeEach(async () => {
    prisma = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  it('treats an expired subscription as inactive', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.hasActiveSubscription('u1')).resolves.toBe(false);

    const endDateMatch = expect.objectContaining({
      gt: expect.any(Date) as Date,
    }) as { gt: Date };
    const whereClauseMatch = expect.objectContaining({
      endDate: endDateMatch,
    }) as { endDate: unknown };
    const callArgMatch = expect.objectContaining({
      where: whereClauseMatch,
    }) as { where: unknown };
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(callArgMatch);
  });

  it('keeps a canceled subscription entitled until its end date', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1' });

    await expect(service.hasActiveSubscription('u1')).resolves.toBe(true);
    const endDateMatch = expect.objectContaining({
      gt: expect.any(Date) as Date,
    }) as { gt: Date };
    const whereMatch = expect.objectContaining({
      status: { in: ['ACTIVE', 'CANCELED'] },
      endDate: endDateMatch,
    }) as { status: { in: string[] }; endDate: { gt: Date } };
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: whereMatch }),
    );
  });

  it('cancels renewal without shortening the paid access period', async () => {
    const endDate = new Date('2026-09-01T00:00:00Z');
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      endDate,
    });
    prisma.subscription.update.mockResolvedValue({ id: 'sub-1' });

    await service.cancel('u1');

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'CANCELED', autoRenew: false },
    });
    const [update] = prisma.subscription.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(update.data).not.toHaveProperty('endDate');
  });
});
