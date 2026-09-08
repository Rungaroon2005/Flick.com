import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpChannel } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { OtpService, type OtpRequestResult } from './otp/otp.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

export interface OtpAuthResult {
  success: true;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string;
  };
  isNewUser: boolean;
  access_token: string;
}

/**
 * Passwordless authentication. There is no password path: proving control of
 * a phone number (or of an email already verified on the account) is the only
 * way to obtain a session.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
  ) {}

  requestOtp(dto: RequestOtpDto, ipAddress: string): Promise<OtpRequestResult> {
    return this.otpService.request({
      destination: dto.destination,
      channel: dto.channel ?? OtpChannel.SMS,
      ipAddress,
    });
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<OtpAuthResult> {
    const { userId, isNewUser } = await this.otpService.verify({
      destination: dto.destination,
      channel: dto.channel ?? OtpChannel.SMS,
      ref: dto.ref,
      code: dto.code,
    });

    const user = await this.usersService.findById(userId);
    // Only reachable if the row was deleted between the verify transaction
    // committing and this read — but a token must never be minted for a user
    // we cannot load.
    if (!user) throw new UnauthorizedException();

    const payload = { sub: user.id, email: user.email };
    return {
      success: true,
      // Explicitly projected, never spread: spreading the Prisma row would
      // put passwordHash on the wire the moment someone adds a field.
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
      },
      isNewUser,
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
