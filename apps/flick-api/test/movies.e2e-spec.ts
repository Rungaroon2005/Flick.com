import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';
import { OTP_DELIVERY_PORT } from './../src/auth/otp/otp-delivery.port';
import type { ConsoleOtpDeliveryAdapter } from './../src/auth/otp/adapters/console-delivery.adapter';

// A dedicated destination, not the seeded/shared one auth.e2e-spec and
// entitlement.e2e-spec already log in with -- avoids coordinating an
// OTP_COOLDOWN_MS collision with either of them.
const USER_A_PHONE = '+66800000010';
const EPISODE_ID = 'sathu-premium';

/** True if `value` contains an object key matching /watch|progress|percent/i
 *  anywhere at any depth -- the exact shape a leaked personal field could
 *  take, regardless of which level of the /movies payload it turned up at. */
function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) =>
        /watch|progress|percent/i.test(key) || containsForbiddenKey(nested),
    );
  }
  return false;
}

describe('GET /movies cache invariant (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let delivery: ConsoleOtpDeliveryAdapter;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    delivery = app.get<ConsoleOtpDeliveryAdapter>(OTP_DELIVERY_PORT, {
      strict: false,
    });

    await prisma.otpChallenge.deleteMany({
      where: { destination: USER_A_PHONE },
    });
  });

  afterAll(async () => {
    await prisma.watchHistory.deleteMany({
      where: { episodeId: EPISODE_ID, user: { phone: USER_A_PHONE } },
    });
    await app.close();
  });

  it("never lets a user's watch progress reach the shared, public /movies payload", async () => {
    // User A logs in for real and records real progress on a real,
    // published, premium episode -- the richest personal-data case this
    // endpoint could leak.
    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: USER_A_PHONE })
      .expect(200);
    const { ref } = requested.body as { ref: string };
    const code = delivery.lastCodeFor(USER_A_PHONE);
    expect(code).toBeDefined();
    const verified = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: USER_A_PHONE, ref, code })
      .expect(200);
    const userACookie = verified.headers['set-cookie'] as unknown as string[];

    await request(app.getHttpServer())
      .put(`/me/watch-history/${EPISODE_ID}`)
      .set('Cookie', userACookie)
      .send({ progressSeconds: 137 })
      .expect(200);

    // An entirely anonymous caller -- the strongest form of "another
    // user": /movies is @Public(), and the cache it reads from is one
    // shared slot for every caller regardless of auth state.
    const publicView = await request(app.getHttpServer())
      .get('/movies')
      .expect(200);

    expect(containsForbiddenKey(publicView.body)).toBe(false);
    // A sanity check that this test actually looked at real content, not
    // an empty array a bug could trivially pass against.
    expect((publicView.body as unknown[]).length).toBeGreaterThan(0);
  });
});
