import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('UsersService', () => {
  let service: UsersService;
  let prismaMock: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prismaMock = createPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('findByEmail passes the email to prisma.user.findUnique and returns the result', async () => {
    const mockUser = { id: 'u1', email: 'test@b.com', displayName: 'Test', passwordHash: 'hash' };
    prismaMock.user.findUnique.mockResolvedValue(mockUser);
    const result = await service.findByEmail('test@b.com');
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@b.com' } });
    expect(result).toEqual(mockUser);
  });
});
