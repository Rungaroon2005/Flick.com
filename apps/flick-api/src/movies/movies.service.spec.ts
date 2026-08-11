import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { MoviesService } from './movies.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('MoviesService', () => {
  let service: MoviesService;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let cacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MoviesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get<MoviesService>(MoviesService);
  });

  it('create calls cacheManager.del with the correct cache key', async () => {
    prismaMock.movie.create.mockResolvedValue({ id: 'm1', title: 'Test' });
    cacheManager.del.mockResolvedValue(undefined);
    await service.create({ title: 'Test', originalLanguage: 'th' });
    expect(cacheManager.del).toHaveBeenCalledWith('movies:all');
    expect(prismaMock.movie.create).toHaveBeenCalled();
  });
});
