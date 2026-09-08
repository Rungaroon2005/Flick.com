import { BadRequestException, Injectable } from '@nestjs/common';
import { SceneMarker, SceneMarkerKind } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MoviesService } from '../movies/movies.service';
import { UpsertSceneMarkerDto } from './dto/upsert-scene-marker.dto';

@Injectable()
export class SceneMarkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movies: MoviesService,
  ) {}

  async list(episodeId: string): Promise<SceneMarker[]> {
    return this.prisma.sceneMarker.findMany({ where: { episodeId } });
  }

  /** Sum of every marker's duration, for finish-time estimation (Task B1). */
  async skippableSeconds(episodeId: string): Promise<number> {
    const markers = await this.list(episodeId);
    return markers.reduce(
      (total, m) => total + (m.endSeconds - m.startSeconds),
      0,
    );
  }

  /**
   * Keyed on the (episodeId, kind) compound unique, so a retried PUT cannot
   * create a duplicate intro -- it's the same idempotent-PUT shape as the
   * rest of the API (see EngagementController's bookmark/like routes).
   */
  async upsert(
    episodeId: string,
    kind: SceneMarkerKind,
    dto: UpsertSceneMarkerDto,
  ): Promise<SceneMarker> {
    if (dto.endSeconds <= dto.startSeconds) {
      throw new BadRequestException(
        'endSeconds must be greater than startSeconds',
      );
    }
    const marker = await this.prisma.sceneMarker.upsert({
      where: { episodeId_kind: { episodeId, kind } },
      create: { episodeId, kind, ...dto },
      update: dto,
    });
    // Markers ride in the cached /movies payload (Tier 1 -- identical for
    // every viewer, unlike videoUrl), so a change here must invalidate it
    // exactly as MoviesService.create() does for its own writes.
    await this.movies.invalidateCache();
    return marker;
  }

  /** deleteMany, not delete: removing an already-absent marker is a no-op,
   *  not a 404 -- the DELETE is idempotent the same way EngagementService's
   *  removeBookmark/unlikeMovie are. */
  async remove(episodeId: string, kind: SceneMarkerKind): Promise<void> {
    await this.prisma.sceneMarker.deleteMany({ where: { episodeId, kind } });
    await this.movies.invalidateCache();
  }
}
