import { BadRequestException } from '@nestjs/common';
import { SceneMarkerKind } from '@prisma/client';
import { SceneMarkersService } from './scene-markers.service';
import { PrismaService } from '../prisma.service';
import { MoviesService } from '../movies/movies.service';
import { createPrismaMock } from '../testing/prisma.mock';

describe('SceneMarkersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let movies: { invalidateCache: jest.Mock };
  let service: SceneMarkersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    movies = { invalidateCache: jest.fn().mockResolvedValue(undefined) };
    service = new SceneMarkersService(
      prisma as unknown as PrismaService,
      movies as unknown as MoviesService,
    );
  });

  describe('list', () => {
    it('returns every marker for an episode', async () => {
      const markers = [
        {
          id: '1',
          episodeId: 'e1',
          kind: SceneMarkerKind.INTRO,
          startSeconds: 0,
          endSeconds: 30,
        },
      ];
      prisma.sceneMarker.findMany.mockResolvedValue(markers);

      await expect(service.list('e1')).resolves.toEqual(markers);
      expect(prisma.sceneMarker.findMany).toHaveBeenCalledWith({
        where: { episodeId: 'e1' },
      });
    });
  });

  describe('skippableSeconds', () => {
    it('sums the duration of every marker', async () => {
      prisma.sceneMarker.findMany.mockResolvedValue([
        { startSeconds: 0, endSeconds: 30 },
        { startSeconds: 1400, endSeconds: 1430 },
      ]);
      await expect(service.skippableSeconds('e1')).resolves.toBe(60);
    });

    it('is zero when the episode has no markers', async () => {
      prisma.sceneMarker.findMany.mockResolvedValue([]);
      await expect(service.skippableSeconds('e1')).resolves.toBe(0);
    });
  });

  describe('upsert', () => {
    it('rejects endSeconds <= startSeconds before reaching Prisma', async () => {
      await expect(
        service.upsert('e1', SceneMarkerKind.INTRO, {
          startSeconds: 30,
          endSeconds: 30,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsert('e1', SceneMarkerKind.INTRO, {
          startSeconds: 30,
          endSeconds: 10,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.sceneMarker.upsert).not.toHaveBeenCalled();
    });

    it('upserts keyed on the (episodeId, kind) compound unique, idempotently', async () => {
      const dto = { startSeconds: 0, endSeconds: 30 };
      prisma.sceneMarker.upsert.mockResolvedValue({
        id: 'm1',
        episodeId: 'e1',
        kind: SceneMarkerKind.INTRO,
        ...dto,
      });

      await service.upsert('e1', SceneMarkerKind.INTRO, dto);

      expect(prisma.sceneMarker.upsert).toHaveBeenCalledWith({
        where: {
          episodeId_kind: { episodeId: 'e1', kind: SceneMarkerKind.INTRO },
        },
        create: { episodeId: 'e1', kind: SceneMarkerKind.INTRO, ...dto },
        update: dto,
      });
    });

    it('invalidates the movies cache after a successful upsert', async () => {
      prisma.sceneMarker.upsert.mockResolvedValue({});
      await service.upsert('e1', SceneMarkerKind.INTRO, {
        startSeconds: 0,
        endSeconds: 30,
      });
      expect(movies.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate the cache when validation rejects first', async () => {
      await expect(
        service.upsert('e1', SceneMarkerKind.INTRO, {
          startSeconds: 30,
          endSeconds: 10,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(movies.invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes by (episodeId, kind) and invalidates the cache', async () => {
      prisma.sceneMarker.deleteMany.mockResolvedValue({ count: 1 });
      await service.remove('e1', SceneMarkerKind.INTRO);

      expect(prisma.sceneMarker.deleteMany).toHaveBeenCalledWith({
        where: { episodeId: 'e1', kind: SceneMarkerKind.INTRO },
      });
      expect(movies.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('is idempotent -- removing an already-absent marker does not throw', async () => {
      prisma.sceneMarker.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        service.remove('e1', SceneMarkerKind.INTRO),
      ).resolves.not.toThrow();
    });
  });
});
