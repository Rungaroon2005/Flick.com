import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('login strips access_token from response and sets cookie', async () => {
    const mockRes = {
      cookie: jest.fn(),
    } as any;
    authService.login.mockResolvedValue({
      success: true,
      user: { id: 'u1', email: 'a@b.com', displayName: 'A' },
      access_token: 'tok123',
    });
    const result = await controller.login({ email: 'a@b.com', password: 'pass' }, mockRes);
    expect(result).not.toHaveProperty('access_token');
    expect(result).toHaveProperty('success', true);
    expect(mockRes.cookie).toHaveBeenCalledWith('access_token', 'tok123', expect.any(Object));
  });
});
