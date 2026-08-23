import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OtpService } from './otp.service';
import { OTP_DELIVERY_PORT } from './otp-delivery.port';
import { ConsoleOtpDeliveryAdapter } from './adapters/console-delivery.adapter';

/**
 * Delivery adapter selection lives here, mirroring the Redis-vs-in-memory
 * branch in movies.module.ts. Phase 3 extends the factory with real SMS and
 * email adapters; until then every environment logs the code.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    OtpService,
    { provide: OTP_DELIVERY_PORT, useClass: ConsoleOtpDeliveryAdapter },
  ],
  // OTP_DELIVERY_PORT is exported so the e2e harness can resolve the console
  // adapter and read back the code it "delivered".
  exports: [OtpService, OTP_DELIVERY_PORT],
})
export class OtpModule {}
