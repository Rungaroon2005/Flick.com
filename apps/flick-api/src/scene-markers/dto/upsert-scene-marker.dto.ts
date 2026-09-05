import { IsInt, Min } from 'class-validator';

/**
 * Cross-field validation (endSeconds > startSeconds) is NOT expressed here
 * via a class-validator decorator -- there's no existing custom-constraint
 * precedent in this codebase, and the check is simple enough that
 * SceneMarkersService just does it explicitly before ever reaching Prisma.
 * The scene_markers_range_valid CHECK constraint is the backstop, not the
 * primary defense.
 */
export class UpsertSceneMarkerDto {
  @IsInt()
  @Min(0)
  startSeconds: number;

  @IsInt()
  @Min(1)
  endSeconds: number;
}
