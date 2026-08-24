import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import ms from 'ms';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './current-user.decorator';
import { DEFAULT_JWT_EXPIRES_IN } from './jwt.config';

@Controller('auth')
export class AuthController {
  private readonly tokenMaxAge: number;

  constructor(
    private readonly authService: AuthService,
    config: ConfigService,
  ) {
    const expiresIn = config.get<string>(
      'JWT_EXPIRES_IN',
      DEFAULT_JWT_EXPIRES_IN,
    );
    this.tokenMaxAge = ms(expiresIn as ms.StringValue);
  }

  private setTokenCookie(res: Response, token: string) {
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.tokenMaxAge,
    });
  }

  /**
   * Issues a code to `destination`. The response is byte-identical whether or
   * not an account exists — see OtpService.request. The @Throttle here is a
   * coarse per-IP guard; the per-destination cooldown and caps that actually
   * stop SMS-bombing live in OtpService.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.authService.requestOtp(dto, req.ip ?? 'unknown');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('otp/verify')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(dto);
    this.setTokenCookie(res, result.access_token);
    // The token goes in an HttpOnly cookie and nowhere else — never in a body
    // a script could read.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { access_token: _, ...safeResult } = result;
    return safeResult;
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
