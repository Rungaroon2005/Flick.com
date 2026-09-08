import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';
import { OTP_DELIVERY_PORT } from './../src/auth/otp/otp-delivery.port';
import type { ConsoleOtpDeliveryAdapter } from './../src/auth/otp/adapters/console-delivery.adapter';

// A dedicated destination -- avoids an OTP_COOLDOWN_MS collision with the
// other e2e specs that log in via OTP.
const USER_PHONE = '+66800000012';
const EPISODE_ID = 'sathu-premium';

describe('GET /me/watch-status (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let delivery: ConsoleOtpDeliveryAdapter;
  let userCookie: string;

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
      where: { destination: USER_PHONE },
    });

    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: USER_PHONE })
      .expect(200);
    const { ref } = requested.body as { ref: string };
    const code = delivery.lastCodeFor(USER_PHONE);
    expect(code).toBeDefined();
    const verified = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: USER_PHONE, ref, code })
      .expect(200);
    userCookie = verified.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.watchHistory.deleteMany({
      where: { episodeId: EPISODE_ID, user: { phone: USER_PHONE } },
    });
    await app.close();
  });

  it('401s an anonymous caller -- this is personal data', async () => {
    await request(app.getHttpServer())
      .get('/me/watch-status?movieIds=sathu')
      .expect(401);
  });

  it('400s a missing movieIds', async () => {
    await request(app.getHttpServer())
      .get('/me/watch-status')
      .set('Cookie', userCookie)
      .expect(400);
  });

  it("reports 'none' for a movie never watched by this user", async () => {
    const res = await request(app.getHttpServer())
      .get('/me/watch-status?movieIds=sathu')
      .set('Cookie', userCookie)
      .expect(200);
    expect(res.body).toEqual({
      sathu: { state: 'none', percent: 0, lastWatchedAt: null },
    });
  });

  it('reflects real recorded progress against the real database', async () => {
    // sathu has FIVE episodes (1 + 2 + 2 + 1 minutes, plus sathu-premium at
    // 10) -- percent is a whole-movie average, not just this one episode's
    // own fraction. 300s of sathu-premium's 600s, against a movie-wide total
    // of 960s, is 300/960 -- 31%, not the 50% this one episode alone would
    // suggest. The number tracks seed.ts's episode list: add an episode
    // there and this expectation moves.
    await request(app.getHttpServer())
      .put(`/me/watch-history/${EPISODE_ID}`)
      .set('Cookie', userCookie)
      .send({ progressSeconds: 300 })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/me/watch-status?movieIds=sathu')
      .set('Cookie', userCookie)
      .expect(200);

    const body = res.body as Record<
      string,
      { state: string; percent: number; lastWatchedAt: string | null }
    >;
    expect(body.sathu).toMatchObject({ state: 'partial', percent: 31 });
    expect(body.sathu.lastWatchedAt).not.toBeNull();
  });
});
