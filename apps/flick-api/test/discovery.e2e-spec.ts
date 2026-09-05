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
const USER_PHONE = '+66800000011';

describe('GET /discovery/fits (e2e)', () => {
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
    await app.close();
  });

  it('401s an anonymous caller -- this is personal data, never @Public()', async () => {
    await request(app.getHttpServer())
      .get('/discovery/fits?maxMinutes=30')
      .expect(401);
  });

  it('rejects a maxMinutes value outside the whitelist with 400', async () => {
    await request(app.getHttpServer())
      .get('/discovery/fits?maxMinutes=45')
      .set('Cookie', userCookie)
      .expect(400);
  });

  it('rejects a missing maxMinutes with 400, not a 500', async () => {
    await request(app.getHttpServer())
      .get('/discovery/fits')
      .set('Cookie', userCookie)
      .expect(400);
  });

  it('accepts a whitelisted maxMinutes and returns real catalogue items', async () => {
    // Proves the query-string "30" actually reaches @IsIn as the NUMBER
    // 30, not the string "30" -- the one thing genuinely new here (the
    // per-route transform:true override), verified against the real app
    // rather than assumed.
    const res = await request(app.getHttpServer())
      .get('/discovery/fits?maxMinutes=30')
      .set('Cookie', userCookie)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const items = res.body as Array<{
      kind: string;
      runtimeMinutes: number;
      finishesAtHint: string;
      episode: Record<string, unknown>;
    }>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(['film', 'next_episode', 'first_episode']).toContain(item.kind);
      expect(item.runtimeMinutes).toBeLessThanOrEqual(30);
      expect(Number.isNaN(Date.parse(item.finishesAtHint))).toBe(false);
      // The one field that must never reach a browsing/discovery response.
      expect(item.episode).not.toHaveProperty('videoUrl');
    }
  });

  it('filters by a real seeded mood tag', async () => {
    // dao-sindome, ngao and sena are seeded with mood "thrill"; sathu,
    // neephee and rak are not -- against the real seeded database, not a
    // mock, so this proves the join actually reaches Postgres.
    const res = await request(app.getHttpServer())
      .get('/discovery/fits?maxMinutes=90&mood=thrill')
      .set('Cookie', userCookie)
      .expect(200);

    const items = res.body as Array<{ movie: { id: string } }>;
    const movieIds = items.map((item) => item.movie.id);
    expect(movieIds).toEqual(
      expect.arrayContaining(['dao-sindome', 'ngao', 'sena']),
    );
    expect(movieIds).not.toEqual(
      expect.arrayContaining(['sathu', 'neephee', 'rak']),
    );
  });

  it('returns an empty list for a mood slug nobody has tagged, not an error', async () => {
    const res = await request(app.getHttpServer())
      .get('/discovery/fits?maxMinutes=90&mood=nonexistent-slug')
      .set('Cookie', userCookie)
      .expect(200);

    expect(res.body).toEqual([]);
  });
});
