import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    authService = { requestOtp: jest.fn(), verifyOtp: jest.fn() };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: () => '7d' } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('passes the caller IP through to the service', async () => {
    authService.requestOtp.mockResolvedValue({ ref: 'AB2C', expiresIn: 300 });

    await controller.requestOtp({ destination: '0812345678' }, {
      ip: '9.9.9.9',
    } as never);

    expect(authService.requestOtp).toHaveBeenCalledWith(
      { destination: '0812345678' },
      '9.9.9.9',
    );
  });

  it('sets an HttpOnly cookie and strips the token from the body', async () => {
    authService.verifyOtp.mockResolvedValue({
      success: true,
      user: { id: 'u1', email: null, phone: '+66812345678', displayName: 'A' },
      isNewUser: false,
      access_token: 'tok',
    });

    const body = await controller.verifyOtp(
      { destination: '0812345678', ref: 'AB2C', code: '123456' },
      res as unknown as Response,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'tok',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(JSON.stringify(body)).not.toContain('tok');
    expect(JSON.stringify(body)).not.toContain('access_token');
    expect(body).toEqual({
      success: true,
      user: { id: 'u1', email: null, phone: '+66812345678', displayName: 'A' },
      isNewUser: false,
    });
  });

  it('no longer exposes password endpoints', () => {
    const asRecord = controller as unknown as Record<string, unknown>;
    expect(asRecord.login).toBeUndefined();
    expect(asRecord.register).toBeUndefined();
  });
});
