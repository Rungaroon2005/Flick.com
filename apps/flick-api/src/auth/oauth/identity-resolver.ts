import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import type { ProviderProfile } from './oauth-provider.port';

type Tx = Prisma.TransactionClient;

export interface ResolvedIdentity {
  userId: string;
  isNewUser: boolean;
  linked: boolean;
}

/**
 * Shown when a provider-verified email matches a local account whose own email
 * was never proven. See the design spec §6.3: this should be unreachable after
 * the migration backfill, and every occurrence is logged at ERROR.
 *
 * Deliberately says "an account", never "your account".
 */
export const EMAIL_CLAIMED =
  'มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม (OTP) แล้วเชื่อมบัญชีโซเชียลในหน้าโปรไฟล์';

/**
 * Answers "which user is this provider account?" — the whole security surface of
 * social login, deliberately kept as a decision over a ProviderProfile with no
 * HTTP, no provider knowledge and no framework in sight.
 */
@Injectable()
export class IdentityResolver {
  private readonly logger = new Logger(IdentityResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    provider: IdentityProvider,
    profile: ProviderProfile,
  ): Promise<ResolvedIdentity> {
    // 1. Known provider account: the common path.
    const existing = await this.prisma.identity.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (existing) {
      if (existing.user.deletedAt) throw new UnauthorizedException();
      return { userId: existing.userId, isNewUser: false, linked: false };
    }

    // 2. No usable email: nothing to match on, so this is a new person. An
    //    UNVERIFIED email lands here too, and that is the point — matching on
    //    one would hand over an account to whoever registered the address at a
    //    provider that does not check it.
    if (!profile.email || !profile.emailVerified) {
      return this.createUser(provider, profile, null);
    }

    // 3. Verified email, no local match: new person, email trusted.
    const claimant = await this.prisma.user.findFirst({
      where: { email: profile.email, deletedAt: null },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!claimant) {
      return this.createUser(provider, profile, profile.email);
    }

    // 4. Local account exists but never proved this address. Linking would log
    //    the address's real owner into someone else's account.
    if (claimant.emailVerifiedAt === null) {
      this.logger.error(
        `Refused to auto-link ${provider} identity to user ${claimant.id}: ` +
          `local email was never verified. This should be unreachable — see ` +
          `docs/superpowers/specs/2026-09-01-social-login-design.md §6.3.`,
      );
      throw new ConflictException(EMAIL_CLAIMED);
    }

    // 5. Both sides proved the same address. Link.
    await this.prisma.identity.create({
      data: this.identityData(provider, profile, claimant.id),
    });
    return { userId: claimant.id, isNewUser: false, linked: true };
  }

  /** User and identity in ONE transaction: an account with no way to sign in is
   *  worse than no account. */
  private async createUser(
    provider: IdentityProvider,
    profile: ProviderProfile,
    email: string | null,
  ): Promise<ResolvedIdentity> {
    const userId = await this.prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.create({
        data: {
          email,
          // Never a timestamp without an email: the two must agree.
          emailVerifiedAt: email ? new Date() : null,
          displayName: displayNameFor(profile),
          isVerified: true,
        },
        select: { id: true },
      });
      await tx.identity.create({
        data: this.identityData(provider, profile, user.id),
      });
      return user.id;
    });

    return { userId, isNewUser: true, linked: false };
  }

  private identityData(
    provider: IdentityProvider,
    profile: ProviderProfile,
    userId: string,
  ) {
    return {
      userId,
      provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      emailVerified: profile.emailVerified,
    };
  }
}

/** Providers do not reliably send a name — Apple sends it once, ever. */
function displayNameFor(profile: ProviderProfile): string {
  if (profile.displayName && profile.displayName.trim().length > 0) {
    return profile.displayName.trim();
  }
  if (profile.email) return profile.email.split('@')[0];
  return `ผู้ใช้${profile.providerAccountId.slice(-4)}`;
}
