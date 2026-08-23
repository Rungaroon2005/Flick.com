import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OtpService } from './otp.service';
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from './otp-delivery.port';
import { ConsoleOtpDeliveryAdapter } from './adapters/console-delivery.adapter';
import { HttpOtpDeliveryAdapter } from './adapters/sms-delivery.adapter';
import { EmailOtpDeliveryAdapter } from './adapters/email-delivery.adapter';
import { RoutingOtpDeliveryAdapter } from './adapters/routing-delivery.adapter';

const logger = new Logger('OtpDelivery');

@Module({
  imports: [ConfigModule],
  providers: [
    OtpService,
    {
      provide: OTP_DELIVERY_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OtpDeliveryPort => {
        // Same shape as the Redis-vs-in-memory branch in movies.module.ts:
        // one config read decides which implementation the app runs with.
        const mode = config.get<string>('OTP_DELIVERY', 'console');

        if (mode === 'console') {
          // validateEnv refuses this combination in production, so reaching
          // here means dev or CI.
          logger.warn(
            'OTP delivery is CONSOLE — codes are logged, not sent. Development only.',
          );
          return new ConsoleOtpDeliveryAdapter();
        }

        return new RoutingOtpDeliveryAdapter(
          new HttpOtpDeliveryAdapter(config),
          new EmailOtpDeliveryAdapter(config),
        );
      },
    },
  ],
  exports: [OtpService, OTP_DELIVERY_PORT],
})
export class OtpModule {}
