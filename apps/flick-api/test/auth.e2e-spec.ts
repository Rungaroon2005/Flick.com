import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';
import { OTP_DELIVERY_PORT } from './../src/auth/otp/otp-delivery.port';
import type { ConsoleOtpDeliveryAdapter } from './../src/auth/otp/adapters/console-delivery.adapter';

describe('Auth OTP (e2e)', () => {
  let app: INestApplication<App>;
  let delivery: ConsoleOtpDeliveryAdapter;
  let prisma: PrismaService;

  // Matches the seeded user. E.164 already normalized.
  const seededPhone = '+66800000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts applies this at bootstrap; the e2e harness must too, or the
    // JwtStrategy cookie extractor never sees req.cookies.
    app.use(cookieParser());
    await app.init();

    // The console adapter is the only way to learn a delivered code: the DB
    // stores a bcrypt hash. strict:false because the provider lives in
    // OtpModule, not the root module.
    delivery = app.get<ConsoleOtpDeliveryAdapter>(OTP_DELIVERY_PORT, {
      strict: false,
    });

    // Same Nest-managed connection the app itself uses — no second pool.
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * OTP_COOLDOWN_MS is 60s per destination, and otp_challenges rows persist
   * across test runs in the shared e2e database. Any test that reuses a
   * destination must clear its prior rows first, or it lands inside the
   * cooldown and gets a 429 instead of the 200 it expects.
   *
   * The cooldown test calls this before its pair of requests but never
   * between them — that test needs the second request to actually collide
   * with the first to prove the control is real.
   */
  async function resetOtpRateLimit(destination: string) {
    await prisma.otpChallenge.deleteMany({ where: { destination } });
  }

  /** Runs a full request→verify round-trip and returns the Set-Cookie header. */
  async function loginViaOtp(phone: string) {
    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(200);

    const { ref } = requested.body as { ref: string };
    const code = delivery.lastCodeFor(phone);
    expect(code).toBeDefined();

    return request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code })
      .expect(200);
  }

  it('rejects a protected route without a cookie', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('completes a request/verify round-trip and authorizes /auth/me', async () => {
    await resetOtpRateLimit(seededPhone);
    const verified = await loginViaOtp(seededPhone);
    const cookies = verified.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookies)
      .expect(200);

    expect((me.body as { id: string }).id).toBe('e2e-free-user');
  });

  it('never returns the access token in a response body', async () => {
    await resetOtpRateLimit(seededPhone);
    const verified = await loginViaOtp(seededPhone);
    expect(JSON.stringify(verified.body)).not.toContain('access_token');
    expect(verified.headers['set-cookie']).toBeDefined();
  });

  it('answers identically for a destination with no account', async () => {
    await resetOtpRateLimit('+66800000009');
    // Enumeration safety: this response must be indistinguishable in shape
    // from the seeded (existing) user's.
    const unknown = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: '+66800000009' })
      .expect(200);

    expect(Object.keys(unknown.body as object).sort()).toEqual([
      'expiresIn',
      'ref',
    ]);
  });

  it('rejects a wrong code and refuses to reuse a consumed one', async () => {
    const phone = '+66800000002';
    await resetOtpRateLimit(phone);
    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(200);
    const { ref } = requested.body as { ref: string };
    const code = delivery.lastCodeFor(phone) as string;

    await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code: '000000' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code })
      .expect(200);

    // Replay of the now-consumed challenge.
    await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: phone, ref, code })
      .expect(401);
  });

  it('enforces the per-destination cooldown', async () => {
    // Reset BEFORE the pair, never between them: the second request has to
    // collide with the first for this test to prove anything. Clearing up
    // front only removes rows earlier runs left behind, which would
    // otherwise make the FIRST request the one that gets refused -- for the
    // wrong reason, and only after this destination had accumulated
    // OTP_LONG_WINDOW_MAX rows.
    const phone = '+66800000003';
    await resetOtpRateLimit(phone);
    await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: phone })
      .expect(429);
  });
});
