import { Controller, Get, Param } from '@nestjs/common';
import { EpisodesService } from './episodes.service';
import { Public } from '../auth/public.decorator';

@Controller('episodes')
export class EpisodesController {
  constructor(private readonly episodesService: EpisodesService) {}

  /**
   * @Public for the same reason `GET /movies/:id` is: this returns catalogue
   * metadata only. The response carries no `videoUrl` (see
   * `EpisodesService.findOne`), so it can never stand in for the
   * entitlement check at `GET /playback/:episodeId/authorize`.
   */
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.episodesService.findOne(id);
  }
}
