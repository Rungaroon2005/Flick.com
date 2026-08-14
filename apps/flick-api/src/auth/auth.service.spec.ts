import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), create: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('tok') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('rejects a login with an unknown email using the generic message', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await expect(
      service.login({ email: 'a@b.com', password: 'password123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('never returns the password hash to the caller', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      displayName: 'A',
      passwordHash: await bcrypt.hash('password123', 4),
    });
    const result = await service.login({
      email: 'a@b.com',
      password: 'password123',
    });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });
});
