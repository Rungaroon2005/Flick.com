import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/** The user is mid-popup; five minutes is generous. */
export const OAUTH_NONCE_TTL_MS = 5 * 60 * 1000;

/** One message for every failure: unknown, expired, wrong provider, replayed. */
const INVALID_NONCE =
  'คำขอเข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ (Invalid or expired login request)';

@Injectable()
export class OAuthNonceService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    provider: IdentityProvider,
  ): Promise<{ nonce: string; expiresIn: number }> {
    const nonce = randomBytes(32).toString('base64url');

    await this.prisma.oAuthNonce.create({
      data: {
        nonce,
        provider,
        expiresAt: new Date(Date.now() + OAUTH_NONCE_TTL_MS),
      },
    });

    return { nonce, expiresIn: Math.floor(OAUTH_NONCE_TTL_MS / 1000) };
  }

  /**
   * Burns the nonce. The guarded updateMany IS the single-use mechanism: two
   * concurrent requests both read a live row, and the second matches zero rows
   * once the first commits. A read-then-write check would race. Same pattern as
   * OtpService.verify.
   */
  async consume(nonce: string, provider: IdentityProvider): Promise<void> {
    const row = await this.prisma.oAuthNonce.findUnique({ where: { nonce } });

    if (
      !row ||
      row.provider !== provider ||
      row.consumedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(INVALID_NONCE);
    }

    const burned = await this.prisma.oAuthNonce.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (burned.count === 0) throw new BadRequestException(INVALID_NONCE);
  }
}
