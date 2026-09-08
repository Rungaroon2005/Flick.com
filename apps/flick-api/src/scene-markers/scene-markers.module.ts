import { Module } from '@nestjs/common';
import { MoviesModule } from '../movies/movies.module';
import { SceneMarkersService } from './scene-markers.service';
import { SceneMarkersAdminController } from './scene-markers.admin.controller';

@Module({
  imports: [MoviesModule],
  controllers: [SceneMarkersAdminController],
  providers: [SceneMarkersService],
  exports: [SceneMarkersService],
})
export class SceneMarkersModule {}
