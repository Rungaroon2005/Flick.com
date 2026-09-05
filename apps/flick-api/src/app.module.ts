import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MoviesModule } from './movies/movies.module';
import { EpisodesModule } from './episodes/episodes.module';
import { PlansController } from './plans/plans.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { OAuthModule } from './auth/oauth/oauth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { PlaybackModule } from './playback/playback.module';
import { EngagementModule } from './engagement/engagement.module';
import { SceneMarkersModule } from './scene-markers/scene-markers.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { validateEnv } from './common/config.validation';
import { DatabaseModule } from './database/database.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    MoviesModule,
    EpisodesModule,
    UsersModule,
    AuthModule,
    OAuthModule,
    SubscriptionsModule,
    PaymentsModule,
    PlaybackModule,
    EngagementModule,
    MaintenanceModule,
    SceneMarkersModule,
    DiscoveryModule,
  ],
  controllers: [AppController, PlansController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }, // order matters: authn then authz
  ],
})
export class AppModule {}
