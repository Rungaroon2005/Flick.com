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
const USER_PHONE = '+66800000013';
const EPISODE_ID = 'sathu-premium';
const MOVIE_ID = 'sathu';

describe('GET /me/passport (e2e)', () => {
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
    await prisma.interaction.deleteMany({
      where: { movieId: MOVIE_ID, user: { phone: USER_PHONE } },
    });
    await app.close();
  });

  it('401s an anonymous caller -- this is personal data', async () => {
    await request(app.getHttpServer()).get('/me/passport').expect(401);
  });

  it('reports an all-zero passport for a user with no history and no likes', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/passport')
      .set('Cookie', userCookie)
      .expect(200);

    expect(res.body).toEqual({
      completedMoviesCount: 0,
      totalWatchedHours: 0,
      topGenre: null,
      likedMoviesCount: 0,
    });
  });

  it('reflects real recorded progress and a real like against the real database', async () => {
    // sathu-premium is a real 10-minute episode of sathu (tagged "drama" in
    // seed.ts) -- watching it in full banks 600s of real watch time.
    await request(app.getHttpServer())
      .put(`/me/watch-history/${EPISODE_ID}`)
      .set('Cookie', userCookie)
      .send({ progressSeconds: 600 })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/me/likes/${MOVIE_ID}`)
      .set('Cookie', userCookie)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/me/passport')
      .set('Cookie', userCookie)
      .expect(200);

    const body = res.body as {
      completedMoviesCount: number;
      totalWatchedHours: number;
      topGenre: { name: string; slug: string } | null;
      likedMoviesCount: number;
    };
    // sathu also has an untouched 1-minute first episode, so the movie as
    // a whole isn't 100% complete yet -- only the raw watched-seconds
    // total and the genre/like tallies are asserted here.
    expect(body.totalWatchedHours).toBe(0.2);
    expect(body.topGenre).toMatchObject({ name: 'ดราม่า', slug: 'drama' });
    expect(body.likedMoviesCount).toBe(1);
  });
});
