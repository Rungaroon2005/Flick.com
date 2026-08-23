import { ConfigService } from '@nestjs/config';
import { FakeGatewayAdapter } from './fake-gateway.adapter';

describe('FakeGatewayAdapter', () => {
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'PAYMENT_WEBHOOK_SECRET' ? 'test-secret' : fallback,
  } as unknown as ConfigService;

  let gateway: FakeGatewayAdapter;

  beforeEach(() => {
    gateway = new FakeGatewayAdapter(config);
  });

  const webhookBody = (overrides = {}) =>
    Buffer.from(
      JSON.stringify({
        id: 'evt_1',
        type: 'charge.complete',
        status: 'SUCCEEDED',
        intentId: 'pi_1',
        chargeId: 'chrg_1',
        amountSatangs: 4900,
        currency: 'THB',
        ...overrides,
      }),
    );

  it('returns a checkout url carrying the intent id', async () => {
    const result = await gateway.createCheckout({
      intentId: 'pi_1',
      amountSatangs: 4900,
      currency: 'THB',
      description: 'Flick Weekly VIP',
      returnUrl: 'https://flick.test/return',
    });

    expect(result.checkoutUrl).toContain('pi_1');
  });

  it('accepts a correctly signed body', async () => {
    const body = webhookBody();
    const signature = gateway.signPayload(body);

    await expect(
      gateway.verifyWebhook(body, { 'x-flick-signature': signature }),
    ).resolves.toBe(true);
  });

  it('rejects a forged signature', async () => {
    await expect(
      gateway.verifyWebhook(webhookBody(), {
        'x-flick-signature': 'deadbeef',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a body altered after signing', async () => {
    // The exact attack the raw-body rule exists to stop: sign a ฿49 charge,
    // then swap the amount.
    const signature = gateway.signPayload(webhookBody());

    await expect(
      gateway.verifyWebhook(webhookBody({ amountSatangs: 1 }), {
        'x-flick-signature': signature,
      }),
    ).resolves.toBe(false);
  });

  it('rejects a missing signature header', async () => {
    await expect(gateway.verifyWebhook(webhookBody(), {})).resolves.toBe(false);
  });

  it('parses a verified body into a GatewayEvent', () => {
    expect(gateway.parseWebhookEvent(webhookBody())).toEqual({
      gatewayEventId: 'evt_1',
      eventType: 'charge.complete',
      status: 'SUCCEEDED',
      intentId: 'pi_1',
      gatewayChargeId: 'chrg_1',
      amountSatangs: 4900,
      currency: 'THB',
    });
  });

  it('throws on a malformed body', () => {
    expect(() => gateway.parseWebhookEvent(Buffer.from('not json'))).toThrow();
    expect(() =>
      gateway.parseWebhookEvent(Buffer.from(JSON.stringify({ id: 'evt_1' }))),
    ).toThrow();
  });
});
