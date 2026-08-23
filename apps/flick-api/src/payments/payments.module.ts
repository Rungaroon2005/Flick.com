import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from './payment-gateway.port';
import { FakeGatewayAdapter } from './adapters/fake-gateway.adapter';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [ConfigModule, WalletModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY_PORT,
      inject: [ConfigService],
      // Phase 6 adds the Omise branch here.
      useFactory: (config: ConfigService): PaymentGatewayPort =>
        new FakeGatewayAdapter(config),
    },
  ],
})
export class PaymentsModule {}
