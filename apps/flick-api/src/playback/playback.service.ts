import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AVAILABLE_EPISODE_FILTER } from '../common/content-availability';

export type PlaybackAuthorization =
  | {
      allowed: true;
      reason: 'free' | 'subscription';
      videoUrl: string;
    }
  | {
      allowed: false;
      reason: 'subscription_required';
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
  ) {}

  /**
   * Resolves entitlement in a fixed precedence, cheapest check first, and
   * short-circuits as soon as one check grants access:
   *   1. free (no DB/service calls beyond the episode lookup itself)
   *   2. active subscription
   *
   * No caching here on purpose — entitlement changes the instant a
   * subscription lapses; a stale cache would grant or deny wrongly.
   */
  async authorize(
    userId: string,
    episodeId: string,
  ): Promise<PlaybackAuthorization> {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, ...AVAILABLE_EPISODE_FILTER },
      select: { id: true, videoUrl: true, isPremium: true },
    });
    if (!episode) throw new NotFoundException('ไม่พบตอนนี้');

    if (!episode.isPremium) {
      return this.grant('free', episode.videoUrl);
    }
    if (await this.subscriptions.hasActiveSubscription(userId)) {
      return this.grant('subscription', episode.videoUrl);
    }
    return { allowed: false, reason: 'subscription_required' };
  }

  /**
   * `videoUrl` is nullable in the schema. An "allowed" result with no URL
   * to actually play is a contract violation, not a valid state to return
   * — surface it as a 503 rather than leaking a `null` the caller would
   * have to special-case.
   */
  private grant(
    reason: 'free' | 'subscription',
    videoUrl: string | null,
  ): PlaybackAuthorization {
    if (videoUrl === null) {
      throw new ServiceUnavailableException('ตอนนี้ยังไม่พร้อมรับชม');
    }
    // TODO: issue a short-lived signed URL
    return { allowed: true, reason, videoUrl };
  }
}
