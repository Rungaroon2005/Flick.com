import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/**
 * Canonical `UserCoin.description` format for an episode-unlock ledger row.
 * Defined once so the format used to WRITE the unlock record and the format
 * used to CHECK for an existing one (the double-charge guard) can never
 * drift apart.
 */
export const unlockDescription = (episodeId: string) =>
  `unlock:episode:${episodeId}`;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Debits `amount` coins from `userId`, writing an append-only ledger row
   * and updating the cached `User.coinBalance` in ONE transaction. The
   * balance check and the write happen inside the same `$transaction` so
   * two concurrent spends cannot both pass the check and drive the balance
   * negative (Postgres's default READ COMMITTED transaction, combined with
   * the row being read-then-written here, serializes concurrent spends on
   * the same user).
   */
  async spend(
    userId: string,
    amount: number,
    description: string,
  ): Promise<number> {
    if (amount <= 0) {
      throw new BadRequestException('จำนวนเหรียญไม่ถูกต้อง');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { coinBalance: true },
      });
      if (!user) throw new NotFoundException();
      if (user.coinBalance < amount) {
        throw new BadRequestException('เหรียญไม่เพียงพอ (Insufficient coins)');
      }

      const balanceAfter = user.coinBalance - amount;
      await tx.userCoin.create({
        data: {
          userId,
          transactionType: TransactionType.SPENT,
          amount: -amount,
          balanceAfter,
          description,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { coinBalance: balanceAfter },
      });
      return balanceAfter;
    });
  }

  /**
   * Credits `amount` coins to `userId` (e.g. EARNED, PURCHASED, REFUNDED).
   * For internal use only — there is no public "buy coins" endpoint here;
   * that requires a payment gateway integration that is out of scope for
   * this task. `paymentEventId` links the ledger row to a `PaymentEvent`
   * once that integration exists.
   */
  async credit(
    userId: string,
    amount: number,
    type: TransactionType,
    description: string,
    paymentEventId?: string,
  ): Promise<number> {
    if (amount <= 0) {
      throw new BadRequestException('จำนวนเหรียญไม่ถูกต้อง');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { coinBalance: true },
      });
      if (!user) throw new NotFoundException();

      const balanceAfter = user.coinBalance + amount;
      await tx.userCoin.create({
        data: {
          userId,
          transactionType: type,
          amount,
          balanceAfter,
          description,
          ...(paymentEventId ? { paymentEventId } : {}),
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { coinBalance: balanceAfter },
      });
      return balanceAfter;
    });
  }

  /** Has this user already unlocked this episode? Consumed by Task 2.5. */
  async hasUnlocked(userId: string, episodeId: string): Promise<boolean> {
    const existing = await this.prisma.userCoin.findFirst({
      where: { userId, description: unlockDescription(episodeId) },
    });
    return existing !== null;
  }

  /**
   * Unlocks a premium episode for `userId`. The price is ALWAYS read
   * server-side from `episode.coinCost` — the client only supplies an
   * `episodeId`, never an amount. No-ops (does not charge again) if the
   * episode is already unlocked.
   */
  async unlockEpisode(
    userId: string,
    episodeId: string,
  ): Promise<{ balance: number; unlocked: true }> {
    const alreadyUnlocked = await this.hasUnlocked(userId, episodeId);
    if (alreadyUnlocked) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { coinBalance: true },
      });
      return { balance: user?.coinBalance ?? 0, unlocked: true };
    }

    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
    });
    if (!episode) throw new NotFoundException('ไม่พบตอนนี้');

    if (!episode.coinCost || episode.coinCost <= 0) {
      throw new BadRequestException('ตอนนี้ไม่ต้องใช้เหรียญ');
    }

    const balance = await this.spend(
      userId,
      episode.coinCost,
      unlockDescription(episodeId),
    );
    return { balance, unlocked: true };
  }

  /** Cached balance plus the 50 most recent ledger rows. */
  async getWallet(userId: string) {
    const [user, transactions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { coinBalance: true },
      }),
      this.prisma.userCoin.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    if (!user) throw new NotFoundException();
    return { balance: user.coinBalance, transactions };
  }
}
