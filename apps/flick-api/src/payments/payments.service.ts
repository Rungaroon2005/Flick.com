import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { resolveCatalogItem, type CatalogItemType } from './catalog';
import {
  PAYMENT_GATEWAY_PORT,
  type GatewayEvent,
  type PaymentGatewayPort,
} from './payment-gateway.port';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

type Tx = Prisma.TransactionClient;

/** An unpaid intent stops being honourable after this long. */
const INTENT_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly appBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
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

  /**
   * The ONLY path that grants paid access. A browser returning from the
   * gateway proves nothing — anyone can request that URL — so entitlement
   * hangs entirely off a signature-verified server-to-server callback.
   */
  async handleWebhook(
    gatewayName: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: true }> {
    if (gatewayName !== this.gateway.name) {
      throw new BadRequestException('Unknown gateway');
    }

    // Verify BEFORE parsing: until this returns true, rawBody is nothing but
    // attacker-controlled bytes.
    const verified = await this.gateway.verifyWebhook(rawBody, headers);
    if (!verified) {
      this.logger.warn(
        `Rejected ${gatewayName} webhook with an invalid signature`,
      );
      throw new BadRequestException('Invalid signature');
    }

    let event: GatewayEvent;
    try {
      event = this.gateway.parseWebhookEvent(rawBody);
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    await this.fulfill(event);

    // Always 200 once the event is durably handled — including the "nothing to
    // do" cases. A non-200 makes the gateway retry a state that will never
    // change.
    return { received: true };
  }

  private async fulfill(event: GatewayEvent): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const intent = await tx.paymentIntent.findUnique({
          where: { id: event.intentId },
        });
        if (!intent) {
          // Nothing to attribute the event to — PaymentEvent.userId is
          // required, so there is no row we could even write.
          this.logger.warn(
            `Webhook ${event.gatewayEventId} references unknown intent ${event.intentId}`,
          );
          return;
        }

        // THE idempotency gate. gatewayEventId is @unique, so a replayed
        // delivery throws P2002 here and aborts the whole transaction before
        // touching any state. No read-then-write check — that would race.
        const paymentEvent = await tx.paymentEvent.create({
          data: {
            userId: intent.userId,
            eventType: event.eventType,
            gateway: this.gateway.name,
            gatewayEventId: event.gatewayEventId,
            // Derived from the event's own natural key so that a SECOND,
            // different event for the same intent (pending → succeeded, or a
            // later refund) does not collide on this unique column.
            idempotencyKey: `${this.gateway.name}:${event.gatewayEventId}`,
            status: event.status,
            amountSatangs: event.amountSatangs,
            currency: event.currency,
            // Allowlisted fields only. Never the raw provider payload — it can
            // carry cardholder details we have no business storing.
            metadata: {
              intentId: event.intentId,
              gatewayChargeId: event.gatewayChargeId,
            },
          },
        });

        if (event.status === 'PENDING') return; // recorded; nothing to grant

        if (intent.status !== 'PENDING') {
          this.logger.log(
            `Intent ${intent.id} is already ${intent.status}; ignoring ${event.eventType}`,
          );
          return;
        }

        if (intent.expiresAt.getTime() < Date.now()) {
          await tx.paymentIntent.updateMany({
            where: { id: intent.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          });
          this.logger.warn(
            `Intent ${intent.id} expired before its webhook landed`,
          );
          return;
        }

        if (
          event.amountSatangs !== intent.amountSatangs ||
          event.currency !== intent.currency
        ) {
          this.logger.error(
            `Amount mismatch on intent ${intent.id}: gateway said ${event.amountSatangs} ${event.currency}, we recorded ${intent.amountSatangs} ${intent.currency}`,
          );
          return;
        }

        if (event.status === 'FAILED') {
          await tx.paymentIntent.updateMany({
            where: { id: intent.id, status: 'PENDING' },
            data: { status: 'FAILED', gatewayChargeId: event.gatewayChargeId },
          });
          return;
        }

        // Guarded transition. If a concurrent delivery already claimed this
        // intent, count is 0 and we grant nothing — this is what stops a
        // double subscription or a double coin credit.
        const claimed = await tx.paymentIntent.updateMany({
          where: { id: intent.id, status: 'PENDING' },
          data: { status: 'SUCCEEDED', gatewayChargeId: event.gatewayChargeId },
        });
        if (claimed.count === 0) return;

        // A retired or repriced catalog item makes resolveCatalogItem throw
        // here. Letting that escape would roll the whole transaction back —
        // destroying the PaymentEvent audit row — and return non-200, so the
        // gateway would retry forever against a catalog that will never
        // un-retire the item. The payment genuinely arrived; record that fact,
        // keep the intent SUCCEEDED, and leave the entitlement for a human.
        try {
          await this.grantEntitlement(tx, intent);
        } catch (grantErr) {
          this.logger.error(
            `MANUAL RECONCILIATION REQUIRED: payment succeeded but entitlement could not be granted. ` +
              `intent=${intent.id} user=${intent.userId} item=${intent.itemType}:${intent.itemId} ` +
              `gatewayEventId=${event.gatewayEventId} paymentEvent=${paymentEvent.id}`,
            grantErr instanceof Error ? grantErr.stack : String(grantErr),
          );
        }
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Replay. The transaction rolled back, so nothing partial survives.
        this.logger.log(
          `Duplicate webhook ${event.gatewayEventId} ignored (already recorded)`,
        );
        return;
      }
      throw err;
    }
  }

  /** Runs inside the caller's transaction — never opens one of its own. */
  private async grantEntitlement(
    tx: Tx,
    intent: {
      id: string;
      userId: string;
      itemType: string;
      itemId: string;
    },
  ): Promise<void> {
    // Re-resolved server-side rather than trusted from the stored row, so the
    // price/duration source of truth stays plans.config.ts.
    const item = resolveCatalogItem(
      intent.itemType as CatalogItemType,
      intent.itemId,
    );

    const startDate = new Date();
    await tx.subscription.create({
      data: {
        userId: intent.userId,
        planType: intent.itemId,
        status: SubscriptionStatus.ACTIVE,
        // One-time purchases only: no stored card, nothing to auto-charge.
        autoRenew: false,
        startDate,
        endDate: new Date(startDate.getTime() + item.durationMs),
        paymentMethod: this.gateway.name,
      },
    });
    this.logger.log(`Subscription granted for intent ${intent.id}`);
  }
}
