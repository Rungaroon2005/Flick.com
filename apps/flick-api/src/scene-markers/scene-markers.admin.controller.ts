import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Put,
} from '@nestjs/common';
import { Role, SceneMarkerKind } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { SceneMarkersService } from './scene-markers.service';
import { UpsertSceneMarkerDto } from './dto/upsert-scene-marker.dto';

/**
 * Admin-only: the global JwtAuthGuard + RolesGuard combination (app.module.ts)
 * already protects every route by default, so @Roles(Role.ADMIN) here is the
 * only decorator needed -- there is no @Public() to counteract.
 */
@Controller('admin/episodes/:episodeId/markers')
@Roles(Role.ADMIN)
export class SceneMarkersAdminController {
  constructor(private readonly sceneMarkers: SceneMarkersService) {}

  @Get()
  list(@Param('episodeId') episodeId: string) {
    return this.sceneMarkers.list(episodeId);
  }

  @Put(':kind')
  upsert(
    @Param('episodeId') episodeId: string,
    @Param('kind', new ParseEnumPipe(SceneMarkerKind)) kind: SceneMarkerKind,
    @Body() dto: UpsertSceneMarkerDto,
  ) {
    return this.sceneMarkers.upsert(episodeId, kind, dto);
  }

  @Delete(':kind')
  remove(
    @Param('episodeId') episodeId: string,
    @Param('kind', new ParseEnumPipe(SceneMarkerKind)) kind: SceneMarkerKind,
  ) {
    return this.sceneMarkers.remove(episodeId, kind);
  }
}
