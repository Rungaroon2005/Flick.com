export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT');

export interface CheckoutRequest {
  /** Our PaymentIntent id. MUST be round-tripped through gateway metadata so
   *  the webhook can be tied back to the intent it belongs to. */
  intentId: string;
  amountSatangs: number;
  currency: string;
  description: string;
  returnUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  /** Null when the gateway only reveals its charge id in the webhook. */
  gatewayChargeId: string | null;
}

export type GatewayEventStatus = 'SUCCEEDED' | 'FAILED' | 'PENDING';

export interface GatewayEvent {
  /** The gateway's own event id. Its uniqueness is our whole idempotency story. */
  gatewayEventId: string;
  eventType: string;
  status: GatewayEventStatus;
  intentId: string;
  gatewayChargeId: string;
  amountSatangs: number;
  currency: string;
}

export interface PaymentGatewayPort {
  /** Stored on PaymentIntent.gateway and matched against the :gateway route param. */
  readonly name: string;

  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Async on purpose: some gateways verify by HMAC over the raw body, others
   * (Omise) by re-fetching the event from their API. `rawBody` is the exact
   * bytes received — never a re-serialized parse.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<boolean>;

  /** Called only after verifyWebhook resolved true. Throws on malformed input. */
  parseWebhookEvent(rawBody: Buffer): GatewayEvent;
}
