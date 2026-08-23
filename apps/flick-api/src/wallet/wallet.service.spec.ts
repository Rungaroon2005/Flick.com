import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('WalletService', () => {
  let service: WalletService;
  let prisma: ReturnType<typeof createPrismaMock>;
  // The service's `spend()` runs everything inside `prisma.$transaction`.
  // Our fixed mock passes the SAME instance into the transaction callback,
  // so stubbing `prisma.*` is equivalent to stubbing `tx.*` here.
  let tx: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    tx = prisma;

    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  it('refuses to spend more coins than the user holds', async () => {
    // `spend()` reads the balance via a `SELECT ... FOR UPDATE` row lock
    // (tx.$queryRaw), not tx.user.findUnique — see wallet.service.ts's
    // lockUserRow for why a plain findUnique isn't safe under concurrency.
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 5 }]);
    await expect(service.spend('u1', 10, 'unlock:episode:e1')).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.userCoin.create).not.toHaveBeenCalled();
  });

  it('writes a negative ledger row with the correct balanceAfter', async () => {
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 100 }]);
    await service.spend('u1', 30, 'unlock:episode:e1');
    // `expect.objectContaining` is typed to return `any` in @types/jest, so
    // it needs a cast here to avoid tripping `no-unsafe-assignment` — the
    // cast doesn't change the runtime matcher, just its static type.
    const ledgerRowMatch = expect.objectContaining({
      amount: -30,
      balanceAfter: 70,
      transactionType: 'SPENT',
    }) as { amount: number; balanceAfter: number; transactionType: string };
    expect(tx.userCoin.create).toHaveBeenCalledWith({
      data: ledgerRowMatch,
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { coinBalance: 70 },
    });
  });

  it('does not charge twice for the same episode', async () => {
    // unlockEpisode locks the user row first, then re-checks for an
    // existing unlock ledger row inside the SAME locked transaction —
    // both stubs are needed to reach the double-charge guard.
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 100 }]);
    tx.userCoin.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.unlockEpisode('u1', 'e1')).resolves.toMatchObject({
      unlocked: true,
    });
    expect(tx.userCoin.create).not.toHaveBeenCalled();
  });

  it('serializes concurrent unlocks: the second call sees the first one already unlocked (no double charge)', async () => {
    // Simulates what `SELECT ... FOR UPDATE` guarantees on a real
    // database: the second concurrent call only proceeds after the first
    // has fully committed, so it observes the ledger row the first call
    // wrote. Mocked $transaction calls run sequentially here (there's no
    // real lock in-memory), so we model that ordering explicitly: the
    // first call's userCoin.create is what makes the SECOND call's
    // findFirst see an existing row.
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 100 }]);
    tx.episode.findFirst.mockResolvedValue({ coinCost: 10 });
    let unlocked = false;
    tx.userCoin.findFirst.mockImplementation(() =>
      Promise.resolve(unlocked ? { id: 'existing' } : null),
    );
    tx.userCoin.create.mockImplementation(() => {
      unlocked = true;
      return Promise.resolve({});
    });

    const first = await service.unlockEpisode('u1', 'e1');
    const second = await service.unlockEpisode('u1', 'e1');

    expect(first.unlocked).toBe(true);
    expect(second.unlocked).toBe(true);
    expect(tx.userCoin.create).toHaveBeenCalledTimes(1);
  });

  it('does not charge for a deleted episode or one belonging to hidden content', async () => {
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 100 }]);
    tx.userCoin.findFirst.mockResolvedValue(null);
    tx.episode.findFirst.mockResolvedValue(null);

    await expect(service.unlockEpisode('u1', 'hidden')).rejects.toThrow();

    expect(tx.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'hidden',
          deletedAt: null,
          season: {
            movie: { status: 'PUBLISHED', deletedAt: null },
          },
        }) as object,
      }),
    );
    expect(tx.userCoin.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('joins a caller-supplied transaction instead of opening its own', async () => {
    // The webhook drives one transaction across PaymentEvent, PaymentIntent
    // and the coin ledger. If credit() opened its own, a crash could leave
    // coins credited for a payment we never recorded.
    const outerTx = createPrismaMock();
    outerTx.$queryRaw.mockResolvedValue([{ coinBalance: 10 }]);

    const balance = await service.credit(
      'u1',
      100,
      TransactionType.PURCHASED,
      'purchase:coinpack:starter',
      'pe1',
      outerTx as unknown as Prisma.TransactionClient,
    );

    expect(balance).toBe(110);
    expect(outerTx.userCoin.create).toHaveBeenCalled();
    // The service must NOT have started a transaction of its own.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still opens its own transaction when none is supplied', async () => {
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 10 }]);

    await service.credit(
      'u1',
      100,
      TransactionType.PURCHASED,
      'purchase:coinpack:starter',
    );

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('links the ledger row to its payment event', async () => {
    tx.$queryRaw.mockResolvedValue([{ coinBalance: 0 }]);

    await service.credit(
      'u1',
      320,
      TransactionType.PURCHASED,
      'purchase:coinpack:popular',
      'pe1',
    );

    // `expect.objectContaining` is typed to return `any` in @types/jest, so
    // it needs a cast here to avoid tripping `no-unsafe-assignment` — see
    // the identical note above on the `ledgerRowMatch` cast.
    const ledgerRowMatch = expect.objectContaining({
      amount: 320,
      balanceAfter: 320,
      paymentEventId: 'pe1',
    }) as { amount: number; balanceAfter: number; paymentEventId: string };
    expect(tx.userCoin.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: ledgerRowMatch }),
    );
  });

  it('rejects a non-positive credit before touching the ledger', async () => {
    await expect(
      service.credit('u1', 0, TransactionType.PURCHASED, 'bad'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.userCoin.create).not.toHaveBeenCalled();
  });
});
