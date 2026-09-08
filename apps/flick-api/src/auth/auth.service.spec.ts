import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpChannel } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp/otp.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findById: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let otpService: { request: jest.Mock; verify: jest.Mock };

  beforeEach(async () => {
    usersService = { findById: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('tok') };
    otpService = { request: jest.fn(), verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: OtpService, useValue: otpService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('defaults the channel to SMS and forwards the caller IP', async () => {
    otpService.request.mockResolvedValue({ ref: 'AB2C', expiresIn: 300 });

    await service.requestOtp({ destination: '0812345678' }, '1.2.3.4');

    expect(otpService.request).toHaveBeenCalledWith({
      destination: '0812345678',
      channel: OtpChannel.SMS,
      ipAddress: '1.2.3.4',
    });
  });

  it('returns only ref and expiresIn from a request', async () => {
    otpService.request.mockResolvedValue({ ref: 'AB2C', expiresIn: 300 });
    const result = await service.requestOtp(
      { destination: '0812345678' },
      '1.2.3.4',
    );
    expect(Object.keys(result).sort()).toEqual(['expiresIn', 'ref']);
  });

  it('issues a token for a verified user and never exposes passwordHash', async () => {
    otpService.verify.mockResolvedValue({ userId: 'u1', isNewUser: false });
    usersService.findById.mockResolvedValue({
      id: 'u1',
      email: null,
      phone: '+66812345678',
      displayName: 'ผู้ใช้5678',
      passwordHash: null,
    });

    const result = await service.verifyOtp({
      destination: '0812345678',
      ref: 'AB2C',
      code: '123456',
    });

    expect(result.access_token).toBe('tok');
    expect(result.isNewUser).toBe(false);
    expect(result.user).toEqual({
      id: 'u1',
      email: null,
      phone: '+66812345678',
      displayName: 'ผู้ใช้5678',
    });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });

  it('reports isNewUser for a lazily created account', async () => {
    otpService.verify.mockResolvedValue({ userId: 'u2', isNewUser: true });
    usersService.findById.mockResolvedValue({
      id: 'u2',
      email: null,
      phone: '+66899999999',
      displayName: 'ผู้ใช้9999',
    });

    const result = await service.verifyOtp({
      destination: '0899999999',
      ref: 'AB2C',
      code: '123456',
    });
    expect(result.isNewUser).toBe(true);
  });

  it('rejects when the verified user has vanished', async () => {
    otpService.verify.mockResolvedValue({ userId: 'gone', isNewUser: false });
    usersService.findById.mockResolvedValue(null);

    await expect(
      service.verifyOtp({
        destination: '0812345678',
        ref: 'AB2C',
        code: '123456',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('no longer exposes password authentication', () => {
    expect(
      (service as unknown as Record<string, unknown>).login,
    ).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).register,
    ).toBeUndefined();
  });
});
