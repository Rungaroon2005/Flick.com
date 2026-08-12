import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
    tx.episode.findUnique.mockResolvedValue({ id: 'e1', coinCost: 10 });
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
});
