import { Controller, Get, Param } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('playback')
export class PlaybackController {
  constructor(private readonly playbackService: PlaybackService) {}

  // Intentionally NOT @Public() — the global JwtAuthGuard (Task 1.3)
  // protects this by default, so an anonymous request gets a 401.
  @Get(':episodeId/authorize')
  authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('episodeId') episodeId: string,
  ) {
    return this.playbackService.authorize(user.id, episodeId);
  }
}
