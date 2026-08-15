import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AVAILABLE_EPISODE_FILTER } from '../common/content-availability';

/**
 * Canonical `UserCoin.description` format for an episode-unlock ledger row.
 * Defined once so the format used to WRITE the unlock record and the format
 * used to CHECK for an existing one (the double-charge guard) can never
 * drift apart.
 */
export const unlockDescription = (episodeId: string) =>
  `unlock:episode:${episodeId}`;

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Locks the user's row for the remainder of the enclosing transaction via
   * `SELECT ... FOR UPDATE` and returns its current `coinBalance`.
   *
   * This is load-bearing, not decorative: merely wrapping a
   * read-then-conditionally-write in `$transaction` does NOT prevent two
   * concurrent calls from both reading the same starting balance, both
   * passing a `balance >= amount` check, and both issuing
   * `UPDATE ... SET "coinBalance" = <precomputed literal>` — Postgres's
   * READ COMMITTED "first updater wins, re-check" protection only kicks in
   * when the UPDATE's value expression references the row's current state
   * (e.g. `SET x = x - 1`); it does nothing for a literal computed in
   * application code. `FOR UPDATE` closes that gap explicitly: the second
   * concurrent transaction blocks here until the first commits (or rolls
   * back), then observes the first transaction's post-commit balance.
   */
  private async lockUserRow(
    tx: Tx,
    userId: string,
  ): Promise<{ coinBalance: number } | null> {
    const rows = await tx.$queryRaw<
      { coinBalance: number }[]
    >`SELECT "coinBalance" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Writes the SPENT ledger row and the new cached balance. Callers must
   * have already locked the user row (via `lockUserRow`) and validated
   * `currentBalance >= amount` within the SAME transaction — this method
   * does no locking or validation of its own.
   */
  private async writeSpendLedgerRow(
    tx: Tx,
    userId: string,
    currentBalance: number,
    amount: number,
    description: string,
  ): Promise<number> {
    const balanceAfter = currentBalance - amount;
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
  }

  /**
   * Debits `amount` coins from `userId`, writing an append-only ledger row
   * and updating the cached `User.coinBalance` in ONE transaction. The row
   * lock acquired by `lockUserRow` (held for the transaction's duration)
   * is what actually serializes concurrent spends on the same user — see
   * its doc comment for why `$transaction` alone is not sufficient.
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
      const user = await this.lockUserRow(tx, userId);
      if (!user) throw new NotFoundException();
      if (user.coinBalance < amount) {
        throw new BadRequestException('เหรียญไม่เพียงพอ (Insufficient coins)');
      }

      return this.writeSpendLedgerRow(
        tx,
        userId,
        user.coinBalance,
        amount,
        description,
      );
    });
  }

  /**
   * Credits `amount` coins to `userId` (e.g. EARNED, PURCHASED, REFUNDED).
   * For internal use only — there is no public "buy coins" endpoint here;
   * that requires a payment gateway integration that is out of scope for
   * this task. `paymentEventId` links the ledger row to a `PaymentEvent`
   * once that integration exists. Uses the same row-lock pattern as
   * `spend()` for the same reason: a precomputed `balanceAfter` literal is
   * not safe against concurrent credits without it.
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
      const user = await this.lockUserRow(tx, userId);
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

  /**
   * Has this user already unlocked this episode? Consumed by Task 2.5.
   *
   * This is a point-in-time, non-transactional check — fine for read-only
   * callers (e.g. deciding whether to show a "play" vs "unlock" button).
   * `unlockEpisode` below does NOT rely on this method for its own
   * double-charge guard; it re-checks inside its own locked transaction,
   * since a check outside (or in a separate transaction from) the write it
   * gates is exactly the kind of race this whole fix closes.
   */
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
   *
   * Everything — the user-row lock, the already-unlocked check, the
   * episode/price lookup, the balance check, and the ledger write — runs
   * inside ONE `$transaction`. The lock acquired up front serializes any
   * two concurrent unlock attempts (or a concurrent unlock and a
   * concurrent plain `spend()`) for the same user: the second call blocks
   * until the first commits, then sees the first call's already-written
   * unlock row and returns the no-op path instead of double-charging.
   */
  async unlockEpisode(
    userId: string,
    episodeId: string,
  ): Promise<{ balance: number; unlocked: true }> {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUserRow(tx, userId);
      if (!user) throw new NotFoundException();

      const existing = await tx.userCoin.findFirst({
        where: { userId, description: unlockDescription(episodeId) },
      });
      if (existing) {
        return { balance: user.coinBalance, unlocked: true as const };
      }

      const episode = await tx.episode.findFirst({
        where: { id: episodeId, ...AVAILABLE_EPISODE_FILTER },
        select: { coinCost: true },
      });
      if (!episode) throw new NotFoundException('ไม่พบตอนนี้');

      if (!episode.coinCost || episode.coinCost <= 0) {
        throw new BadRequestException('ตอนนี้ไม่ต้องใช้เหรียญ');
      }
      if (user.coinBalance < episode.coinCost) {
        throw new BadRequestException('เหรียญไม่เพียงพอ (Insufficient coins)');
      }

      const balance = await this.writeSpendLedgerRow(
        tx,
        userId,
        user.coinBalance,
        episode.coinCost,
        unlockDescription(episodeId),
      );
      return { balance, unlocked: true as const };
    });
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
