import { IsInt, Min } from 'class-validator';

/**
 * `progressSeconds` is the only client-supplied field. `completed` is
 * ALWAYS derived server-side from the episode's own `durationMinutes` in
 * `EngagementService.updateProgress` — never accepted from the client, so
 * a user can't mark an episode "watched" without actually watching it.
 */
export class UpdateProgressDto {
  @IsInt()
  @Min(0)
  progressSeconds: number;
}
