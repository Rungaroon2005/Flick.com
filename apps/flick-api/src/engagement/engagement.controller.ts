import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import { EngagementService } from './engagement.service';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

// Explicit PUT/DELETE throughout, deliberately not a POST /toggle — a
// toggle endpoint isn't idempotent, and a double-tap on mobile (a dropped
// response retried by the client) would silently reverse the user's
// intent instead of being a harmless no-op.
@Controller('me')
export class EngagementController {
  constructor(private readonly engagementService: EngagementService) {}

  // --- Bookmarks ---------------------------------------------------------

  @Get('bookmarks')
  getBookmarks(@CurrentUser() user: AuthenticatedUser) {
    return this.engagementService.getBookmarks(user.id);
  }

  @Put('bookmarks/:movieId')
  addBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('movieId') movieId: string,
  ) {
    return this.engagementService.addBookmark(user.id, movieId);
  }

  @Delete('bookmarks/:movieId')
  @HttpCode(200)
  removeBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('movieId') movieId: string,
  ) {
    return this.engagementService.removeBookmark(user.id, movieId);
  }

  // --- Movie actions -----------------------------------------------------

  @Get('movies/:movieId/actions')
  getMovieActions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('movieId') movieId: string,
  ) {
    return this.engagementService.getMovieActions(user.id, movieId);
  }

  @Put('likes/:movieId')
  likeMovie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('movieId') movieId: string,
  ) {
    return this.engagementService.likeMovie(user.id, movieId);
  }

  @Delete('likes/:movieId')
  @HttpCode(200)
  unlikeMovie(
    @CurrentUser() user: AuthenticatedUser,
    @Param('movieId') movieId: string,
  ) {
    return this.engagementService.unlikeMovie(user.id, movieId);
  }

  // --- Watch history / continue watching ----------------------------------

  @Get('continue-watching')
  getContinueWatching(@CurrentUser() user: AuthenticatedUser) {
    return this.engagementService.getContinueWatching(user.id);
  }

  @Put('watch-history/:episodeId')
  updateProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('episodeId') episodeId: string,
    @Body() dto: UpdateProgressDto,
  ) {
    return this.engagementService.updateProgress(
      user.id,
      episodeId,
      dto.progressSeconds,
    );
  }

  // --- Downloads -----------------------------------------------------------

  @Get('downloads')
  getDownloads(@CurrentUser() user: AuthenticatedUser) {
    return this.engagementService.getDownloads(user.id);
  }

  @Put('downloads/:episodeId')
  addDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('episodeId') episodeId: string,
  ) {
    return this.engagementService.addDownload(user.id, episodeId);
  }

  @Delete('downloads/:episodeId')
  @HttpCode(200)
  removeDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('episodeId') episodeId: string,
  ) {
    return this.engagementService.removeDownload(user.id, episodeId);
  }
}
