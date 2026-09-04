import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IdentityProvider } from '@prisma/client';
import type { Response } from 'express';
import ms from 'ms';
import { Public } from '../public.decorator';
import { DEFAULT_JWT_EXPIRES_IN } from '../jwt.config';
import { UsersService } from '../../users/users.service';
import {
  OAUTH_PROVIDER_REGISTRY,
  type OAuthProviderRegistry,
} from './oauth-provider.port';
import { OAuthNonceService } from './oauth-nonce.service';
import { IdentityResolver } from './identity-resolver';
import { VerifyOAuthDto } from './dto/verify-oauth.dto';

const PROVIDER_IDS: Record<string, IdentityProvider> = {
  google: IdentityProvider.GOOGLE,
  apple: IdentityProvider.APPLE,
};

@Controller('auth/oauth')
export class OAuthController {
  private readonly tokenMaxAge: number;

  constructor(
    @Inject(OAUTH_PROVIDER_REGISTRY)
    private readonly registry: OAuthProviderRegistry,
    private readonly nonces: OAuthNonceService,
    private readonly resolver: IdentityResolver,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    this.tokenMaxAge = ms(
      config.get<string>(
        'JWT_EXPIRES_IN',
        DEFAULT_JWT_EXPIRES_IN,
      ) as ms.StringValue,
    );
  }

  /** Lets the login screen render only buttons that will work. */
  @Public()
  @Get('providers')
  providers(): { providers: string[] } {
    return {
      providers: [...this.registry.keys()].map((id) => id.toLowerCase()),
    };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('nonce')
  async nonce(
    @Body() body: { provider: string },
  ): Promise<{ nonce: string; expiresIn: number }> {
    return this.nonces.issue(this.adapterFor(body?.provider).id);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('verify')
  async verify(
    @Body() dto: VerifyOAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const adapter = this.adapterFor(dto.provider);

    // Burn the nonce FIRST. Spending it on a token that then fails
    // verification is correct — it was still spent — and doing it the other way
    // round would let an attacker probe token validity for free.
    await this.nonces.consume(dto.nonce, adapter.id);

    const profile = await adapter.verifyIdToken(dto.idToken, dto.nonce);

    // Apple sends the name beside the token, not inside it, so the client
    // passes it through. Unverified, and used only to fill a gap: it can never
    // override what the provider signed.
    if (!profile.displayName && dto.displayName) {
      profile.displayName = dto.displayName;
    }

    const resolved = await this.resolver.resolve(adapter.id, profile);
    const user = await this.users.findById(resolved.userId);
    if (!user) throw new UnauthorizedException();

    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });

    // The same cookie the OTP flow sets — auth.controller.ts:38-46. Social
    // login is a second way to mint the existing session, not a second session.
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.tokenMaxAge,
    });

    // The token goes in the HttpOnly cookie and nowhere a script can read it,
    // exactly as AuthController.verifyOtp strips it (auth.controller.ts:74-76).
    return {
      success: true as const,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
      },
      isNewUser: resolved.isNewUser,
    };
  }

  private adapterFor(provider: string) {
    const id = PROVIDER_IDS[provider?.toLowerCase?.()];
    const adapter = id ? this.registry.get(id) : undefined;
    if (!adapter)
      throw new NotFoundException('Unknown or unconfigured provider');
    return adapter;
  }
}
