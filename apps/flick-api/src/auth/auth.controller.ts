import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import ms from 'ms';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
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

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(registerDto);
    this.setTokenCookie(res, result.access_token);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { access_token: _, ...safeResult } = result;
    return safeResult;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    this.setTokenCookie(res, result.access_token);
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
