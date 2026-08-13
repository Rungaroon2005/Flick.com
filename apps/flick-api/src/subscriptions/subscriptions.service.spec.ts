import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  // `create()` runs everything inside `prisma.$transaction`. Our fixed mock
  // passes the SAME instance into the transaction callback, so stubbing
  // `prisma.*` is equivalent to stubbing `tx.*` here (see wallet.service.spec.ts).
  let tx: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    tx = prisma;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  it('grants exactly 7 days for the weekly plan', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'u1' }]);
    tx.subscription.findFirst.mockResolvedValue(null);

    let captured: { startDate: Date; endDate: Date } | undefined;
    tx.subscription.create.mockImplementation(
      (args: { data: { startDate: Date; endDate: Date } }) => {
        captured = args.data;
        return Promise.resolve({});
      },
    );

    const before = Date.now();
    await service.create('u1', 'weekly');

    expect(captured).toBeDefined();
    expect(captured!.endDate.getTime() - captured!.startDate.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(captured!.startDate.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('rejects the legacy vip-weekly plan id rather than defaulting to monthly', async () => {
    await expect(service.create('u1', 'vip-weekly' as never)).rejects.toThrow(
      BadRequestException,
    );
    // Must fail fast on the invalid plan id — before ever touching the DB.
    expect(prisma.$transaction).not.toHaveBeenCalled();
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

  it('acquires the user row lock before checking for an existing active subscription', async () => {
    // Guards against the check-then-create race: two concurrent POSTs for
    // the same user must not both observe "no active subscription" and
    // both create one. The lock (`tx.$queryRaw` SELECT ... FOR UPDATE) must
    // happen BEFORE the `findFirst` check, both inside the same transaction.
    const callOrder: string[] = [];
    tx.$queryRaw.mockImplementation(() => {
      callOrder.push('lock');
      return Promise.resolve([{ id: 'u1' }]);
    });
    tx.subscription.findFirst.mockImplementation(() => {
      callOrder.push('check');
      return Promise.resolve(null);
    });

    await service.create('u1', 'weekly');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.subscription.findFirst).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['lock', 'check']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a second ACTIVE subscription with a 409-mapping ConflictException', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'u1' }]);
    tx.subscription.findFirst.mockResolvedValue({ id: 'existing-sub' });
    await expect(service.create('u1', 'weekly')).rejects.toThrow();
    expect(tx.subscription.create).not.toHaveBeenCalled();
  });
});
