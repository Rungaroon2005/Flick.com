import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';
import { OTP_DELIVERY_PORT } from './../src/auth/otp/otp-delivery.port';
import { PAYMENT_GATEWAY_PORT } from './../src/payments/payment-gateway.port';
import type { ConsoleOtpDeliveryAdapter } from './../src/auth/otp/adapters/console-delivery.adapter';
import type { FakeGatewayAdapter } from './../src/payments/adapters/fake-gateway.adapter';

describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let gateway: FakeGatewayAdapter;
  let prisma: PrismaService;
  let cookies: string[];
  let seededUserId: string;

  // Matches the seeded user (prisma/seed.ts). E.164 already normalized.
  const seededPhone = '+66800000001';

  /**
   * The "activates a subscription" test grants a REAL ACTIVE subscription
   * to the seeded user against Postgres. prisma/seed.ts only upserts the
   * User row — it does not reset subscriptions — so without this cleanup a
   * subscription created by one run of this suite survives to the next run
   * (and to entitlement.e2e-spec.ts, whose "no subscription and no coins"
   * assertions depend on this same seeded user starting unentitled).
   */
  async function clearSeededUserSubscriptions() {
    await prisma.subscription.deleteMany({ where: { userId: seededUserId } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // rawBody must be enabled here too, exactly as main.ts does it — without
    // it req.rawBody is undefined and every webhook 400s.
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    // main.ts registers this global pipe at bootstrap time — it is NOT wired
    // as an APP_PIPE provider in AppModule, so a TestingModule built from
    // AppModule alone never gets it. Without this, forbidNonWhitelisted is a
    // no-op here and the "supplies its own price" test would wrongly pass.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    gateway = app.get<FakeGatewayAdapter>(PAYMENT_GATEWAY_PORT, {
      strict: false,
    });
    const delivery = app.get<ConsoleOtpDeliveryAdapter>(OTP_DELIVERY_PORT, {
      strict: false,
    });

    // OTP_COOLDOWN_MS is 60s per destination, and otp_challenges rows persist
    // across e2e specs in the shared database — auth.e2e-spec.ts and
    // entitlement.e2e-spec.ts both log in with this same seeded number
    // shortly before this suite runs under --runInBand. Clear its rows first
    // or this request lands inside the cooldown and gets a 429 instead of
    // the 200 login expects.
    prisma = app.get(PrismaService);
    await prisma.otpChallenge.deleteMany({
      where: { destination: seededPhone },
    });

    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: seededPhone })
      .expect(200);
    const verified = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({
        destination: seededPhone,
        ref: (requested.body as { ref: string }).ref,
        code: delivery.lastCodeFor(seededPhone),
      })
      .expect(200);
    cookies = verified.headers['set-cookie'] as unknown as string[];

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookies)
      .expect(200);
    seededUserId = (me.body as { id: string }).id;

    // Start from a known-unentitled state regardless of what a previous run
    // of this suite (or a manual retry) left behind.
    await clearSeededUserSubscriptions();
  });

  afterAll(async () => {
    // Leave the seeded user as we found it so entitlement.e2e-spec.ts (and a
    // future run of this suite) isn't affected by the ACTIVE subscription
    // the "activates a subscription" test intentionally creates.
    await clearSeededUserSubscriptions();
    await app.close();
  });

  /** Creates an intent and returns its id. */
  async function checkout(itemType: string, itemId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/payments/checkout')
      .set('Cookie', cookies)
      .send({ itemType, itemId })
      .expect(200);
    return (res.body as { intentId: string }).intentId;
  }

  /** Posts a webhook signed the way the gateway would sign it. */
  function postWebhook(payload: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify(payload));
    // Send the already-serialized string, not the Buffer itself: superagent
    // re-JSON.stringifies a Buffer body (wrapping it as {type,data}) when
    // Content-Type is application/json, which silently changes the bytes on
    // the wire and no longer matches what signPayload hashed below it.
    return request(app.getHttpServer())
      .post('/payments/webhook/fake')
      .set('Content-Type', 'application/json')
      .set('x-flick-signature', gateway.signPayload(body))
      .send(body.toString('utf8'));
  }

  const chargeEvent = (intentId: string, overrides = {}) => ({
    id: `evt_${intentId}`,
    type: 'charge.complete',
    status: 'SUCCEEDED',
    intentId,
    chargeId: `chrg_${intentId}`,
    amountSatangs: 4900,
    currency: 'THB',
    ...overrides,
  });

  it('requires a session to start a checkout', () => {
    return request(app.getHttpServer())
      .post('/payments/checkout')
      .send({ itemType: 'SUBSCRIPTION', itemId: 'weekly' })
      .expect(401);
  });

  it('rejects an unknown item id', () => {
    return request(app.getHttpServer())
      .post('/payments/checkout')
      .set('Cookie', cookies)
      .send({ itemType: 'SUBSCRIPTION', itemId: 'vip-weekly' })
      .expect(400);
  });

  it('refuses a request that tries to supply its own price', () => {
    // forbidNonWhitelisted turns a smuggled amount into a 400 rather than a
    // silently-ignored field.
    return request(app.getHttpServer())
      .post('/payments/checkout')
      .set('Cookie', cookies)
      .send({ itemType: 'SUBSCRIPTION', itemId: 'weekly', amountSatangs: 1 })
      .expect(400);
  });

  it('grants nothing until a verified webhook arrives', async () => {
    await checkout('SUBSCRIPTION', 'weekly');

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);

    // findActive() returns null; Nest/Express send that as an empty body
    // (no Content-Type), which superagent's parser falls back to as `{}`
    // rather than `null` — so `{}` here, not a falsy value, IS "no access".
    // The intent exists, the browser could have "returned" — still no access.
    expect(me.body).toEqual({});
  });

  it('rejects a forged webhook signature', async () => {
    const intentId = await checkout('SUBSCRIPTION', 'weekly');

    await request(app.getHttpServer())
      .post('/payments/webhook/fake')
      .set('Content-Type', 'application/json')
      .set('x-flick-signature', 'deadbeef')
      .send(JSON.stringify(chargeEvent(intentId)))
      .expect(400);

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(me.body).toEqual({});
  });

  it('activates a subscription on a verified webhook', async () => {
    const intentId = await checkout('SUBSCRIPTION', 'weekly');
    await postWebhook(chargeEvent(intentId)).expect(200);

    const me = await request(app.getHttpServer())
      .get('/subscriptions/me')
      .set('Cookie', cookies)
      .expect(200);

    const subscription = me.body as { planType: string; autoRenew: boolean };
    expect(subscription.planType).toBe('weekly');
    expect(subscription.autoRenew).toBe(false);
  });

  it('is idempotent under duplicate delivery', async () => {
    const intentId = await checkout('COIN_PACK', 'starter');
    const event = chargeEvent(intentId, { amountSatangs: 3500 });

    const before = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    await postWebhook(event).expect(200);
    await postWebhook(event).expect(200); // replay
    await postWebhook(event).expect(200); // and again

    const after = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    const delta =
      (after.body as { balance: number }).balance -
      (before.body as { balance: number }).balance;
    // Credited exactly once, no matter how many times the gateway retried.
    expect(delta).toBe(100);
  });

  it('ignores a webhook whose amount does not match the intent', async () => {
    const intentId = await checkout('COIN_PACK', 'starter');

    const before = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    await postWebhook(chargeEvent(intentId, { amountSatangs: 1 })).expect(200);

    const after = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);
    expect((after.body as { balance: number }).balance).toBe(
      (before.body as { balance: number }).balance,
    );
  });

  it('never lets a later SUCCEEDED overwrite a FAILED intent', async () => {
    const intentId = await checkout('COIN_PACK', 'starter');

    const before = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);

    await postWebhook(
      chargeEvent(intentId, {
        id: `evt_fail_${intentId}`,
        status: 'FAILED',
        amountSatangs: 3500,
      }),
    ).expect(200);

    await postWebhook(
      chargeEvent(intentId, {
        id: `evt_late_${intentId}`,
        status: 'SUCCEEDED',
        amountSatangs: 3500,
      }),
    ).expect(200);

    const after = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', cookies)
      .expect(200);
    expect((after.body as { balance: number }).balance).toBe(
      (before.body as { balance: number }).balance,
    );
  });

  it('answers 200 for a webhook referencing no known intent', () => {
    // A 4xx here would make a real gateway retry forever.
    return postWebhook(chargeEvent('pi_does_not_exist')).expect(200);
  });
});
