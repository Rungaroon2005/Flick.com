import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CheckoutRequest,
  CheckoutResult,
  GatewayEvent,
  GatewayEventStatus,
  PaymentGatewayPort,
} from '../payment-gateway.port';

const SIGNATURE_HEADER = 'x-flick-signature';
const VALID_STATUSES: GatewayEventStatus[] = ['SUCCEEDED', 'FAILED', 'PENDING'];

/**
 * Deterministic gateway for tests and local development. It implements the
 * real HMAC-over-raw-body verification so the webhook path under test is the
 * same code path production uses — only the vendor differs.
 */
@Injectable()
export class FakeGatewayAdapter implements PaymentGatewayPort {
  readonly name = 'fake';
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('PAYMENT_WEBHOOK_SECRET', 'dev-secret');
  }

  createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    return Promise.resolve({
      checkoutUrl: `https://fake-gateway.local/checkout/${request.intentId}?return=${encodeURIComponent(request.returnUrl)}`,
      // This fake reveals its charge id only in the webhook, exercising the
      // nullable branch of CheckoutResult.
      gatewayChargeId: null,
    });
  }

  /** Test helper: produce the signature a real sender would attach. */
  signPayload(rawBody: Buffer): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<boolean> {
    const provided = headers[SIGNATURE_HEADER];
    if (typeof provided !== 'string') return Promise.resolve(false);

    const expected = Buffer.from(this.signPayload(rawBody), 'utf8');
    const actual = Buffer.from(provided, 'utf8');
    if (expected.length !== actual.length) return Promise.resolve(false);
    return Promise.resolve(timingSafeEqual(expected, actual));
  }

  parseWebhookEvent(rawBody: Buffer): GatewayEvent {
    const parsed = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const asPrimitive = (value: unknown): string | number | undefined =>
      typeof value === 'string' || typeof value === 'number'
        ? value
        : undefined;

    const event: GatewayEvent = {
      gatewayEventId: String(asPrimitive(parsed.id) ?? ''),
      eventType: String(asPrimitive(parsed.type) ?? ''),
      status: parsed.status as GatewayEventStatus,
      intentId: String(asPrimitive(parsed.intentId) ?? ''),
      gatewayChargeId: String(asPrimitive(parsed.chargeId) ?? ''),
      amountSatangs: Number(parsed.amountSatangs),
      currency: String(asPrimitive(parsed.currency) ?? ''),
    };

    // A malformed event must fail loudly here rather than reach the
    // fulfillment transaction with NaN or empty ids.
    if (
      !event.gatewayEventId ||
      !event.intentId ||
      !VALID_STATUSES.includes(event.status) ||
      !Number.isInteger(event.amountSatangs)
    ) {
      throw new Error('Malformed gateway event');
    }
    return event;
  }
}
