import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('7d') },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('login strips access_token from response and sets cookie', async () => {
    const cookie = jest.fn();
    const mockRes = {
      cookie,
    } as unknown as Response;
    authService.login.mockResolvedValue({
      success: true,
      user: { id: 'u1', email: 'a@b.com', displayName: 'A' },
      access_token: 'tok123',
    });
    const result = await controller.login(
      { email: 'a@b.com', password: 'pass' },
      mockRes,
    );
    expect(result).not.toHaveProperty('access_token');
    expect(result).toHaveProperty('success', true);
    expect(cookie).toHaveBeenCalledWith(
      'access_token',
      'tok123',
      expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 * 1000 }),
    );
  });
});
