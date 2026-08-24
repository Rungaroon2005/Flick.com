import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from './payment-gateway.port';
import { FakeGatewayAdapter } from './adapters/fake-gateway.adapter';
import { OmiseGatewayAdapter } from './adapters/omise-gateway.adapter';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [ConfigModule, WalletModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentGatewayPort => {
        const selected = config.get<string>('PAYMENT_GATEWAY', 'fake');
        if (selected === 'omise') return new OmiseGatewayAdapter(config);
        return new FakeGatewayAdapter(config);
      },
    },
  ],
})
export class PaymentsModule {}
