import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { resolveCatalogItem } from './catalog';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from './payment-gateway.port';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

/** An unpaid intent stops being honourable after this long. */
const INTENT_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    private readonly wallet: WalletService,
    config: ConfigService,
  ) {
    this.appBaseUrl = config.get<string>(
      'APP_BASE_URL',
      'http://localhost:3000',
    );
  }

  /**
   * Creates a PENDING intent at a server-resolved price and hands back a
   * gateway checkout URL. Nothing is granted here — the browser returning from
   * that URL proves nothing, so only the webhook can fulfil this intent.
   */
  async createCheckout(
    userId: string,
    dto: CreateCheckoutDto,
  ): Promise<{ checkoutUrl: string; intentId: string }> {
    // Throws before anything is written if the id is not in the catalog.
    const item = resolveCatalogItem(dto.itemType, dto.itemId);

    const intent = await this.prisma.paymentIntent.create({
      data: {
        userId,
        itemType: item.itemType,
        itemId: item.itemId,
        amountSatangs: item.amountSatangs,
        currency: 'THB',
        status: 'PENDING',
        gateway: this.gateway.name,
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      },
    });

    const result = await this.gateway.createCheckout({
      intentId: intent.id,
      amountSatangs: intent.amountSatangs,
      currency: intent.currency,
      description: item.description,
      // A "we're processing your payment" screen, not a success screen: the
      // webhook may not have landed by the time the browser gets back.
      returnUrl: `${this.appBaseUrl}/subscribe/processing?intent=${intent.id}`,
    });

    // Some gateways only reveal their charge id in the webhook; storing it
    // here when offered just gives us a second way to correlate.
    if (result.gatewayChargeId) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { gatewayChargeId: result.gatewayChargeId },
      });
    }

    this.logger.log(
      `Checkout created: intent=${intent.id} item=${item.itemType}:${item.itemId} amount=${item.amountSatangs}`,
    );
    return { checkoutUrl: result.checkoutUrl, intentId: intent.id };
  }
}
