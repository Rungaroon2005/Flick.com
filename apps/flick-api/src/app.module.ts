import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MoviesModule } from './movies/movies.module';
import { PlansController } from './plans/plans.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MoviesModule, 
    UsersModule, 
    AuthModule
  ],
  controllers: [AppController, PlansController],
  providers: [AppService],
})
export class AppModule {}
