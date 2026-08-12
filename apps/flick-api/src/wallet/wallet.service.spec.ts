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
    tx.user.findUnique.mockResolvedValue({ coinBalance: 5 });
    await expect(service.spend('u1', 10, 'unlock:episode:e1')).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.userCoin.create).not.toHaveBeenCalled();
  });

  it('writes a negative ledger row with the correct balanceAfter', async () => {
    tx.user.findUnique.mockResolvedValue({ coinBalance: 100 });
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
    tx.userCoin.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.unlockEpisode('u1', 'e1')).resolves.toMatchObject({
      unlocked: true,
    });
    expect(tx.userCoin.create).not.toHaveBeenCalled();
  });
});
