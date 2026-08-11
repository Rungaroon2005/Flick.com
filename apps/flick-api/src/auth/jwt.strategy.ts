import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

const cookieExtractor = (req: Request): string | null =>
  (req?.cookies?.['access_token'] as string) ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Load the user rather than trusting the payload: catches deleted/demoted
  // users mid-token-life, at the cost of one indexed lookup per request.
  async validate(payload: { sub: string }) {
    const user = await this.users.findById(payload.sub);
    if (!user || user.deletedAt) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      coinBalance: user.coinBalance,
    };
  }
}
