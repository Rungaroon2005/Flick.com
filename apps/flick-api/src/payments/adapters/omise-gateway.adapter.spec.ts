import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { OmiseGatewayAdapter } from './omise-gateway.adapter';

describe('OmiseGatewayAdapter', () => {
  const secretKey = 'skey_test_secret';
  const webhookSecretB64 = Buffer.from('omise-webhook-secret').toString(
    'base64',
  );

  const config = {
    getOrThrow: (key: string) =>
      ({
        OMISE_SECRET_KEY: secretKey,
        OMISE_WEBHOOK_SECRET: webhookSecretB64,
      })[key] as string,
    get: (key: string, fallback?: string) =>
      key === 'OMISE_SOURCE_TYPE' ? 'promptpay' : fallback,
  } as unknown as ConfigService;

  let fetchSpy: jest.SpyInstance;
  let gateway: OmiseGatewayAdapter;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    gateway = new OmiseGatewayAdapter(config);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const sign = (
    rawBody: Buffer,
    timestamp: string,
    secretB64 = webhookSecretB64,
  ) => {
    const secret = Buffer.from(secretB64, 'base64');
    return createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
  };

  const eventBody = (overrides: Record<string, unknown> = {}) => {
    const { data: dataOverrides, ...restOverrides } = overrides;
    return Buffer.from(
      JSON.stringify({
        object: 'event',
        id: 'evnt_test_1',
        key: 'charge.complete',
        livemode: false,
        data: {
          object: 'charge',
          id: 'chrg_test_1',
          status: 'successful',
          amount: 4900,
          currency: 'THB',
          metadata: { intentId: 'pi_1' },
          ...((dataOverrides as Record<string, unknown>) ?? {}),
        },
        ...restOverrides,
      }),
    );
  };

  describe('createCheckout', () => {
    it('posts the amount in satangs, in THB, with our intentId in metadata', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            object: 'charge',
            id: 'chrg_test_1',
            status: 'pending',
            authorize_uri:
              'https://pay.omise.co/payments/paym_test_1/authorize',
          }),
          { status: 200 },
        ),
      );

      await gateway.createCheckout({
        intentId: 'pi_1',
        amountSatangs: 4900,
        currency: 'THB',
        description: 'Flick Weekly VIP',
        returnUrl: 'https://flick.test/return',
      });

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.omise.co/charges');
      expect(init.method).toBe('POST');

      const body = new URLSearchParams(init.body as string);
      expect(body.get('amount')).toBe('4900');
      expect(body.get('currency')).toBe('thb');
      expect(body.get('metadata[intentId]')).toBe('pi_1');
      expect(body.get('return_uri')).toBe('https://flick.test/return');

      // Basic auth carries the secret key; never a literal default.
      const authHeader = (init.headers as Record<string, string>).Authorization;
      expect(authHeader).toBe(
        `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      );

      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('returns the authorize_uri as checkoutUrl and the charge id synchronously', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            object: 'charge',
            id: 'chrg_test_1',
            status: 'pending',
            authorize_uri:
              'https://pay.omise.co/payments/paym_test_1/authorize',
          }),
          { status: 200 },
        ),
      );

      const result = await gateway.createCheckout({
        intentId: 'pi_1',
        amountSatangs: 4900,
        currency: 'THB',
        description: 'Flick Weekly VIP',
        returnUrl: 'https://flick.test/return',
      });

      expect(result.checkoutUrl).toBe(
        'https://pay.omise.co/payments/paym_test_1/authorize',
      );
      expect(result.gatewayChargeId).toBe('chrg_test_1');
    });

    it('throws without leaking the secret key when Omise rejects the request', async () => {
      fetchSpy.mockResolvedValue(new Response('nope', { status: 400 }));

      await expect(
        gateway.createCheckout({
          intentId: 'pi_1',
          amountSatangs: 4900,
          currency: 'THB',
          description: 'Flick Weekly VIP',
          returnUrl: 'https://flick.test/return',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(secretKey) as unknown as string,
        }),
      );
    });
  });

  describe('verifyWebhook', () => {
    it('accepts a correctly signed body', async () => {
      const body = eventBody();
      const timestamp = '1700000000';
      const signature = sign(body, timestamp);

      await expect(
        gateway.verifyWebhook(body, {
          'omise-signature': signature,
          'omise-signature-timestamp': timestamp,
        }),
      ).resolves.toBe(true);
    });

    it('accepts either signature during a secret rotation window', async () => {
      const body = eventBody();
      const timestamp = '1700000000';
      const oldSecretB64 = Buffer.from('old-secret').toString('base64');
      const oldSignature = sign(body, timestamp, oldSecretB64);
      const newSignature = sign(body, timestamp);

      await expect(
        gateway.verifyWebhook(body, {
          'omise-signature': `${oldSignature},${newSignature}`,
          'omise-signature-timestamp': timestamp,
        }),
      ).resolves.toBe(true);
    });

    it('rejects a forged signature — no exception escapes', async () => {
      await expect(
        gateway.verifyWebhook(eventBody(), {
          'omise-signature': 'deadbeef',
          'omise-signature-timestamp': '1700000000',
        }),
      ).resolves.toBe(false);
    });

    it('rejects a body altered after signing', async () => {
      const timestamp = '1700000000';
      const signature = sign(eventBody(), timestamp);

      await expect(
        gateway.verifyWebhook(eventBody({ data: { amount: 1 } }), {
          'omise-signature': signature,
          'omise-signature-timestamp': timestamp,
        }),
      ).resolves.toBe(false);
    });

    it('rejects a missing signature header', async () => {
      await expect(
        gateway.verifyWebhook(eventBody(), {
          'omise-signature-timestamp': '1700000000',
        }),
      ).resolves.toBe(false);
    });

    it('rejects a missing timestamp header', async () => {
      await expect(
        gateway.verifyWebhook(eventBody(), {
          'omise-signature': 'deadbeef',
        }),
      ).resolves.toBe(false);
    });

    it('fails closed when the secret lookup itself throws', async () => {
      const throwingConfig = {
        getOrThrow: () => {
          throw new Error('config unavailable');
        },
        get: (key: string, fallback?: string) => fallback,
      } as unknown as ConfigService;
      const brokenGateway = new OmiseGatewayAdapter(throwingConfig);

      await expect(
        brokenGateway.verifyWebhook(eventBody(), {
          'omise-signature': 'deadbeef',
          'omise-signature-timestamp': '1700000000',
        }),
      ).resolves.toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('maps a successful charge event onto GatewayEventStatus and pulls intentId from metadata', () => {
      expect(gateway.parseWebhookEvent(eventBody())).toEqual({
        gatewayEventId: 'evnt_test_1',
        eventType: 'charge.complete',
        status: 'SUCCEEDED',
        intentId: 'pi_1',
        gatewayChargeId: 'chrg_test_1',
        amountSatangs: 4900,
        currency: 'THB',
      });
    });

    it('maps pending and failed statuses', () => {
      expect(
        gateway.parseWebhookEvent(eventBody({ data: { status: 'pending' } }))
          .status,
      ).toBe('PENDING');
      expect(
        gateway.parseWebhookEvent(eventBody({ data: { status: 'failed' } }))
          .status,
      ).toBe('FAILED');
      expect(
        gateway.parseWebhookEvent(eventBody({ data: { status: 'expired' } }))
          .status,
      ).toBe('FAILED');
      expect(
        gateway.parseWebhookEvent(eventBody({ data: { status: 'reversed' } }))
          .status,
      ).toBe('FAILED');
    });

    it('throws when metadata.intentId is absent', () => {
      expect(() =>
        gateway.parseWebhookEvent(eventBody({ data: { metadata: {} } })),
      ).toThrow();
    });

    it('throws on a malformed body', () => {
      expect(() =>
        gateway.parseWebhookEvent(Buffer.from('not json')),
      ).toThrow();
    });

    it('throws on an unrecognized status', () => {
      expect(() =>
        gateway.parseWebhookEvent(
          eventBody({ data: { status: 'some_future_status' } }),
        ),
      ).toThrow();
    });

    it('normalizes a lowercase currency from an older-API-pinned account', () => {
      // Omise's currency casing depends on the account's pinned API
      // version: accounts pinned before 2019-05-29 report lowercase and are
      // not auto-upgraded, so a real production account can send this
      // forever. PaymentsService.fulfill compares this field against our
      // uppercase-stored PaymentIntent.currency with strict equality, so an
      // un-normalized lowercase value here would fail every such account's
      // webhooks and permanently strand the intent.
      expect(
        gateway.parseWebhookEvent(eventBody({ data: { currency: 'thb' } }))
          .currency,
      ).toBe('THB');
    });

    it('throws when currency is absent', () => {
      expect(() =>
        gateway.parseWebhookEvent(eventBody({ data: { currency: undefined } })),
      ).toThrow(/currency/);
    });
  });
});
