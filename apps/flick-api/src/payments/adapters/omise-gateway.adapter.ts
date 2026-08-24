/**
 * Omise / Opn Payments gateway adapter.
 *
 * ── Research notes (Task 26, Step 1) ──────────────────────────────────────
 * Verified 2026-08-23/24 directly against the raw HTML of docs.omise.co
 * (fetched with curl, not summarized) — https://docs.omise.co/api-webhooks,
 * https://docs.omise.co/charges-api, https://docs.omise.co/events-api, plus
 * https://docs.omise.co/promptpay and the official omise-go SDK source on
 * GitHub. Record kept here so nobody has to re-derive this.
 *
 * 1. WEBHOOK AUTHENTICITY — the brief's working assumption (re-fetch only,
 *    no signing) is OUT OF DATE. Omise/Opn now documents genuine HMAC
 *    signature verification as its *primary, recommended* mechanism
 *    ("Protecting Your Endpoints" § of docs.omise.co/api-webhooks):
 *      - Two headers: `Omise-Signature` (hex HMAC-SHA256, comma-separated
 *        during secret rotation) and `Omise-Signature-Timestamp` (unix secs).
 *      - Signed payload = `${timestamp}.${rawBody}` (raw bytes, UTF-8).
 *      - The webhook secret is issued **Base64-encoded** from the Omise
 *        dashboard (Webhooks Settings) — decode before using as the HMAC
 *        key. This secret is DIFFERENT from `OMISE_SECRET_KEY` (the API
 *        auth key used for REST calls) — it exists purely for webhook
 *        signing and is generated/rotated independently per environment
 *        (test vs. live). We read it from `OMISE_WEBHOOK_SECRET`.
 *      - During a secret roll, Omise signs with both old and new secrets
 *        for 24h and sends both, comma-separated, in `Omise-Signature`; we
 *        must accept either to support zero-downtime rotation.
 *      - Comparison must use `crypto.timingSafeEqual` (Omise's own example
 *        code does this) to avoid timing side-channels.
 *      - Timestamp/replay-window validation is explicitly documented as
 *        OPTIONAL ("a successful signature match alone confirms the webhook
 *        is authentic") — we still require the timestamp header to be
 *        *present* (it is part of the signed payload) but do not enforce a
 *        freshness window, matching the documented minimum.
 *    Omise's docs *also* describe a fallback "event verification" method
 *    (re-fetch the resource by id over the authenticated REST API and
 *    compare) "if signature verification is not feasible" — but the same
 *    page states this fallback "does not prevent your endpoint from
 *    receiving fraudulent requests; it only enables you to verify the
 *    authenticity of the event data after it has been received." Since we
 *    control our own deploy and can always provision a webhook secret, we
 *    implement signature verification only, and enforce (via
 *    config.validation.ts) that `OMISE_WEBHOOK_SECRET` is present whenever
 *    `PAYMENT_GATEWAY=omise` — i.e. production can never boot able to
 *    accept a webhook it cannot cryptographically verify. This is also why
 *    `verifyWebhook` here needs no live HTTP call: it is pure local crypto,
 *    so a stalled Omise API cannot block webhook processing.
 *
 * 2. POST /charges RESPONSE — confirmed via docs.omise.co/charges-api (and
 *    cross-checked against docs.omise.co/promptpay for the redirect-style
 *    source we use here): the charge object, including `id` (chrg_...) AND
 *    `authorize_uri`, comes back SYNCHRONOUSLY in the POST response body —
 *    not only in a later webhook. `gatewayChargeId` is therefore never
 *    null for this adapter (unlike FakeGatewayAdapter, which deliberately
 *    exercises the nullable branch). `authorize_uri` is a generic
 *    Omise-hosted page (`https://pay.omise.co/payments/.../authorize`) that
 *    renders whatever UI the chosen source needs (QR for PromptPay, bank
 *    redirect for internet banking, etc.) and redirects back to
 *    `return_uri` afterwards — exactly the shape `CheckoutResult` expects.
 *    `metadata` sent on the request is echoed back on the charge object and
 *    included verbatim in the `data` of every webhook event for that
 *    charge, which is how `intentId` round-trips.
 *    Wire format: the official docs (every curl example on
 *    docs.omise.co/charges-api) POST `application/x-www-form-urlencoded`
 *    with bracket notation for nested params (`source[type]=promptpay`,
 *    `metadata[intentId]=...`) and HTTP Basic Auth (`-u $OMISE_SECRET_KEY:`,
 *    empty password). We follow that documented wire format. (The official
 *    omise-go SDK instead sends `application/json` with a flat `source`
 *    STRING referencing a pre-created Source object — a two-call pattern.
 *    We use the simpler, single-call, docs-first form-encoded flow.)
 *    `CheckoutRequest` carries no explicit payment-method field, so the
 *    source type is configurable via `OMISE_SOURCE_TYPE` (default
 *    `promptpay`, the dominant method for a Thai-market app) rather than
 *    hard-coded.
 *
 * 3. EVENT SHAPE / STATUS MAPPING — confirmed via docs.omise.co/events-api:
 *    a webhook body is the Event object: top-level `id` (evnt_...), `key`
 *    (event type, e.g. `charge.complete`, `charge.create` — NOT `type`),
 *    and `data` (the nested charge object with its own `id`, `amount`
 *    [already in the smallest currency unit — satangs for THB, no
 *    conversion needed], `currency`, `status`, `metadata`). Documented
 *    charge event keys: charge.create, charge.complete, charge.capture,
 *    charge.reverse, charge.update, charge.expire. Documented charge
 *    `status` values (docs.omise.co/charges-api "Response Object"):
 *    successful | pending | failed | expired | reversed. Mapping onto
 *    `GatewayEventStatus`:
 *      successful -> SUCCEEDED
 *      pending    -> PENDING
 *      failed     -> FAILED  (never completed)
 *      expired    -> FAILED  (never completed; expired before authorization)
 *      reversed   -> FAILED  (funds no longer settled to us — not a state a
 *                    fulfillment flow should treat as retained success)
 *    An unrecognized status throws rather than silently defaulting, same
 *    policy as the missing-intentId case below.
 * ────────────────────────────────────────────────────────────────────────
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CheckoutRequest,
  CheckoutResult,
  GatewayEvent,
  GatewayEventStatus,
  PaymentGatewayPort,
} from '../payment-gateway.port';

const OMISE_API_BASE = 'https://api.omise.co';
const REQUEST_TIMEOUT_MS = 8000;
const SIGNATURE_HEADER = 'omise-signature';
const TIMESTAMP_HEADER = 'omise-signature-timestamp';

const STATUS_MAP: Record<string, GatewayEventStatus> = {
  successful: 'SUCCEEDED',
  pending: 'PENDING',
  failed: 'FAILED',
  expired: 'FAILED',
  reversed: 'FAILED',
};

interface OmiseChargeResponse {
  id?: unknown;
  authorize_uri?: unknown;
}

interface OmiseEventPayload {
  id?: unknown;
  key?: unknown;
  data?: {
    id?: unknown;
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Real production adapter for Omise (Opn Payments). See the file-level
 * comment above for the API research this implementation is based on.
 */
@Injectable()
export class OmiseGatewayAdapter implements PaymentGatewayPort {
  readonly name = 'omise';
  private readonly logger = new Logger('OmiseGateway');

  constructor(private readonly config: ConfigService) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const secretKey = this.config.getOrThrow<string>('OMISE_SECRET_KEY');
    const sourceType = this.config.get<string>(
      'OMISE_SOURCE_TYPE',
      'promptpay',
    );

    const params = new URLSearchParams();
    params.set('amount', String(request.amountSatangs));
    params.set('currency', request.currency.toLowerCase());
    params.set('description', request.description);
    params.set('return_uri', request.returnUrl);
    params.set('source[type]', sourceType);
    params.set('metadata[intentId]', request.intentId);

    const response = await fetch(`${OMISE_API_BASE}/charges`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      },
      body: params,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Never log the secret key or the response body (may echo request
      // params back, including PII); the status code is enough to act on.
      this.logger.error(
        `Omise rejected charge creation (HTTP ${response.status})`,
      );
      throw new Error(
        `Omise charge creation failed with HTTP ${response.status}`,
      );
    }

    const charge = (await response.json()) as OmiseChargeResponse;
    const checkoutUrl =
      typeof charge.authorize_uri === 'string' ? charge.authorize_uri : null;
    const gatewayChargeId = typeof charge.id === 'string' ? charge.id : null;

    if (!checkoutUrl || !gatewayChargeId) {
      this.logger.error(
        `Omise charge response missing authorize_uri or id for intent ${request.intentId}`,
      );
      throw new Error('Omise charge response missing authorize_uri or id');
    }

    return { checkoutUrl, gatewayChargeId };
  }

  /**
   * Pure local HMAC-SHA256 verification per docs.omise.co/api-webhooks —
   * see the file-level comment for why this needs no network call. Never
   * throws; any failure (missing headers, bad secret, mismatch, or an
   * unexpected error) resolves to `false`.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<boolean> {
    // No network call: verification is pure local HMAC comparison, so
    // there is nothing to `await` — but the port's interface is async
    // (other gateways may need to re-fetch), so we still return a Promise.
    return Promise.resolve(this.checkSignature(rawBody, headers));
  }

  private checkSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    try {
      const signatureHeader = headers[SIGNATURE_HEADER];
      const timestampHeader = headers[TIMESTAMP_HEADER];
      if (
        typeof signatureHeader !== 'string' ||
        typeof timestampHeader !== 'string' ||
        signatureHeader.length === 0
      ) {
        return false;
      }

      const secretB64 = this.config.getOrThrow<string>('OMISE_WEBHOOK_SECRET');
      const secret = Buffer.from(secretB64, 'base64');
      const signedPayload = `${timestampHeader}.${rawBody.toString('utf8')}`;
      const expected = createHmac('sha256', secret)
        .update(signedPayload)
        .digest();

      const provided = signatureHeader.split(',').map((s) => s.trim());
      for (const candidate of provided) {
        let candidateBuffer: Buffer;
        try {
          candidateBuffer = Buffer.from(candidate, 'hex');
        } catch {
          continue;
        }
        if (
          candidateBuffer.length === expected.length &&
          timingSafeEqual(candidateBuffer, expected)
        ) {
          return true;
        }
      }
      return false;
    } catch (error) {
      // Fail closed on any unexpected error (e.g. secret lookup throwing).
      this.logger.error(
        `Webhook signature verification errored: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** Called only after verifyWebhook resolved true. Throws on malformed input. */
  parseWebhookEvent(rawBody: Buffer): GatewayEvent {
    const parsed = JSON.parse(rawBody.toString('utf8')) as OmiseEventPayload;
    const data = parsed.data;

    const gatewayEventId =
      typeof parsed.id === 'string' && parsed.id.length > 0
        ? parsed.id
        : undefined;
    const eventType = typeof parsed.key === 'string' ? parsed.key : undefined;
    const gatewayChargeId =
      typeof data?.id === 'string' && data.id.length > 0 ? data.id : undefined;
    const amountSatangs =
      typeof data?.amount === 'number' ? data.amount : undefined;
    const currency =
      typeof data?.currency === 'string' ? data.currency : undefined;
    const rawStatus =
      typeof data?.status === 'string' ? data.status : undefined;
    const metadata = data?.metadata;
    const intentId =
      metadata &&
      typeof metadata.intentId === 'string' &&
      metadata.intentId.length > 0
        ? metadata.intentId
        : undefined;

    // An event we cannot attribute to a PaymentIntent, or whose shape we
    // don't recognize, must not silently coerce into empty/NaN fields —
    // fail loudly here instead of reaching the fulfillment transaction.
    if (!gatewayEventId || !eventType || !gatewayChargeId) {
      throw new Error('Malformed Omise event: missing id/key/data.id');
    }
    if (!intentId) {
      throw new Error(
        'Malformed Omise event: metadata.intentId is missing — cannot attribute to a PaymentIntent',
      );
    }
    if (typeof amountSatangs !== 'number' || !Number.isInteger(amountSatangs)) {
      throw new Error('Malformed Omise event: data.amount is not an integer');
    }
    if (!rawStatus || !(rawStatus in STATUS_MAP)) {
      throw new Error(
        `Malformed Omise event: unrecognized status "${String(rawStatus)}"`,
      );
    }

    return {
      gatewayEventId,
      eventType,
      status: STATUS_MAP[rawStatus],
      intentId,
      gatewayChargeId,
      amountSatangs,
      currency: (currency ?? '').toUpperCase(),
    };
  }
}
