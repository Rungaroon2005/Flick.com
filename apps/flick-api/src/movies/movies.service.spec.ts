import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
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

  const validDto = {
    title: 'Test',
    description: 'A test movie description',
    posterUrl: 'https://example.com/poster.jpg',
    year: 2025,
    contentRating: 'ทั่วไป',
    genreSlugs: ['drama'],
  };

  it('create calls cacheManager.del with the correct cache key', async () => {
    prismaMock.movie.create.mockResolvedValue({
      id: 'm1',
      title: 'Test',
      genres: [],
    });
    cacheManager.del.mockResolvedValue(undefined);
    await service.create(validDto);
    expect(cacheManager.del).toHaveBeenCalledWith('movies:all');
    expect(prismaMock.movie.create).toHaveBeenCalled();
  });

  interface CreateCallArg {
    data: {
      genres: {
        create: {
          genre: {
            connectOrCreate: {
              where: { slug: string };
              create: { slug: string; name: string };
            };
          };
        }[];
      };
    };
  }

  it('maps genre slugs onto the MovieGenre join table', async () => {
    prismaMock.movie.create.mockResolvedValue({ genres: [] });
    await service.create({ ...validDto, genreSlugs: ['drama'] });
    const [arg] = prismaMock.movie.create.mock.calls[0] as [CreateCallArg];
    expect(arg.data).not.toHaveProperty('genreSlugs');
    expect(arg.data.genres.create[0].genre.connectOrCreate.where).toEqual({
      slug: 'drama',
    });
    expect(arg.data.genres.create[0].genre.connectOrCreate.create).toEqual({
      slug: 'drama',
      name: 'drama',
    });
  });

  it('flattens genres in the response payload', async () => {
    prismaMock.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }],
      },
    ]);
    const [movie] = await service.findAll();
    expect(movie.genres).toEqual([{ id: 'g1', name: 'ดราม่า', slug: 'drama' }]);
  });

  it('flattens genres for findOne', async () => {
    prismaMock.movie.findFirst.mockResolvedValue({
      id: 'm1',
      genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }],
    });
    const movie = await service.findOne('m1');
    expect(movie.genres).toEqual([{ id: 'g1', name: 'ดราม่า', slug: 'drama' }]);
  });

  it('excludes draft and soft-deleted movies from findAll', async () => {
    cacheManager.get.mockResolvedValue(undefined);
    prismaMock.movie.findMany.mockResolvedValue([]);
    await service.findAll();
    expect(prismaMock.movie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PUBLISHED', deletedAt: null },
      }),
    );
  });

  it('does not serve a draft movie by direct id', async () => {
    prismaMock.movie.findFirst.mockResolvedValue(null);
    await expect(service.findOne('draft-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('findSimilar', () => {
    it('returns movies sharing at least one genre, excluding itself', async () => {
      prismaMock.movie.findFirst.mockResolvedValue({
        id: 'm1',
        genres: [{ genreId: 'g1' }, { genreId: 'g2' }],
      });
      prismaMock.movie.findMany.mockResolvedValue([
        {
          id: 'm2',
          genres: [{ genre: { id: 'g1', name: 'ดราม่า', slug: 'drama' } }],
        },
      ]);

      const result = await service.findSimilar('m1');

      expect(prismaMock.movie.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PUBLISHED',
          deletedAt: null,
          id: { not: 'm1' },
          genres: { some: { genreId: { in: ['g1', 'g2'] } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { genres: { include: { genre: true } } },
      });
      expect(result).toEqual([
        { id: 'm2', genres: [{ id: 'g1', name: 'ดราม่า', slug: 'drama' }] },
      ]);
    });

    it('throws NotFoundException when the source movie does not exist', async () => {
      prismaMock.movie.findFirst.mockResolvedValue(null);
      await expect(service.findSimilar('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an empty array when the source movie has no genres', async () => {
      prismaMock.movie.findFirst.mockResolvedValue({ id: 'm1', genres: [] });
      const result = await service.findSimilar('m1');
      expect(result).toEqual([]);
      expect(prismaMock.movie.findMany).not.toHaveBeenCalled();
    });
  });
});
