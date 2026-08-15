import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WalletService } from '../wallet/wallet.service';
import { AVAILABLE_EPISODE_FILTER } from '../common/content-availability';

export type PlaybackAuthorization =
  | {
      allowed: true;
      reason: 'free' | 'subscription' | 'unlocked';
      videoUrl: string;
    }
  | {
      allowed: false;
      reason: 'subscription_required' | 'coins_required';
      coinCost: number;
    };

/**
 * The single place that answers "may this user watch this episode?". This
 * is the ONLY server-side path through which a real `videoUrl` is ever
 * returned to a client — `MoviesService.toDto` strips `videoUrl` from every
 * other response (see movies.service.ts) so entitlement can never be
 * bypassed by reading it off `/movies` instead.
 */
@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Resolves entitlement in a fixed precedence, cheapest check first, and
   * short-circuits as soon as one check grants access:
   *   1. free (no DB/service calls beyond the episode lookup itself)
   *   2. active subscription
   *   3. per-episode coin unlock
   *
   * No caching here on purpose — entitlement changes the instant a user
   * spends coins or their subscription lapses; a stale cache would grant or
   * deny wrongly. No `$transaction`/row-locking either — this is a pure
   * read composed of three existing read-only checks, nothing to serialize.
   */
  async authorize(
    userId: string,
    episodeId: string,
  ): Promise<PlaybackAuthorization> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, ...AVAILABLE_EPISODE_FILTER },
      select: { id: true, videoUrl: true, isPremium: true, coinCost: true },
    });
    if (!episode) throw new NotFoundException('ไม่พบตอนนี้');

    if (!episode.isPremium && episode.coinCost === 0) {
      return this.grant('free', episode.videoUrl);
    }
    if (await this.subscriptions.hasActiveSubscription(userId)) {
      return this.grant('subscription', episode.videoUrl);
    }
    if (await this.wallet.hasUnlocked(userId, episodeId)) {
      return this.grant('unlocked', episode.videoUrl);
    }
    return {
      allowed: false,
      reason: episode.coinCost > 0 ? 'coins_required' : 'subscription_required',
      coinCost: episode.coinCost,
    };
  }

  /**
   * `videoUrl` is nullable in the schema. An "allowed" result with no URL
   * to actually play is a contract violation, not a valid state to return
   * — surface it as a 503 rather than leaking a `null` the caller would
   * have to special-case.
   */
  private grant(
    reason: 'free' | 'subscription' | 'unlocked',
    videoUrl: string | null,
  ): PlaybackAuthorization {
    if (videoUrl === null) {
      throw new ServiceUnavailableException('ตอนนี้ยังไม่พร้อมรับชม');
    }
    // TODO: issue a short-lived signed URL
    return { allowed: true, reason, videoUrl };
  }
}
