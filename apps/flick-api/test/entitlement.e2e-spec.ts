import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';
import { OTP_DELIVERY_PORT } from './../src/auth/otp/otp-delivery.port';
import type { ConsoleOtpDeliveryAdapter } from './../src/auth/otp/adapters/console-delivery.adapter';

const PREMIUM_EPISODE_ID = 'sathu-premium';
const DRAFT_MOVIE_ID = 'e2e-draft';
// Matches the seeded user (prisma/seed.ts). E.164 already normalized.
const SEEDED_PHONE = '+66800000001';

describe('Content entitlement (e2e)', () => {
  let app: INestApplication<App>;
  let cache: Cache;
  let freeUserCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    cache = app.get<Cache>(CACHE_MANAGER);

    const prisma = app.get(PrismaService);
    const delivery = app.get<ConsoleOtpDeliveryAdapter>(OTP_DELIVERY_PORT, {
      strict: false,
    });

    // OTP_COOLDOWN_MS is per-destination and otp_challenges rows persist
    // across e2e specs in the shared database — auth.e2e-spec.ts logs in
    // with this same seeded number moments before this suite runs. Clear
    // its rows first or this request lands inside the cooldown and gets a
    // 429 instead of the 200 login() expects.
    await prisma.otpChallenge.deleteMany({
      where: { destination: SEEDED_PHONE },
    });

    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ destination: SEEDED_PHONE })
      .expect(200);
    const { ref } = requested.body as { ref: string };
    const code = delivery.lastCodeFor(SEEDED_PHONE);
    expect(code).toBeDefined();

    const login = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ destination: SEEDED_PHONE, ref, code })
      .expect(200);

    freeUserCookie = login.headers['set-cookie'];
    expect(freeUserCookie).toBeDefined();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Do not let a prior run's Redis entry make the draft-filter regression
    // proof pass against stale data.
    await cache.del('movies:all');
  });

  it('never exposes videoUrl through the movie list', async () => {
    const response = await request(app.getHttpServer())
      .get('/movies')
      .expect(200);
    const body = JSON.stringify(response.body);

    expect(body).toContain(PREMIUM_EPISODE_ID);
    expect(body).not.toContain('videoUrl');
  });

  // GET /episodes/:id replaced the player's full-catalogue walk. It is a new
  // path to episode data, so it needs the same videoUrl guarantee the movie
  // list has — otherwise it becomes a side door around
  // GET /playback/:episodeId/authorize.
  it('never exposes videoUrl through the single-episode endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get(`/episodes/${PREMIUM_EPISODE_ID}`)
      .expect(200);
    const body = JSON.stringify(response.body);

    expect(response.body).toMatchObject({
      episode: { id: PREMIUM_EPISODE_ID, isPremium: true },
      movie: { id: 'sathu' },
    });
    expect(body).not.toContain('videoUrl');
    // The seeded premium episode's real URL, to prove the assertion above is
    // not passing merely because the value happens to be absent.
    expect(body).not.toContain('mux.dev');
  });

  it('404s for an episode that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/episodes/no-such-episode')
      .expect(404);
  });

  // Regression: EpisodesService has its own Prisma include tree, separate
  // from MoviesService and EngagementService's. Adding sceneMarkers to
  // those two (NewPlan Phase B) missed this one entirely, so /episodes/:id
  // -- the endpoint the player page ACTUALLY calls via apiFetchServer --
  // silently omitted it, and the frontend's decodeEpisodeDetail (which
  // requires the field) rejected the response outright, breaking every
  // real player page load. Caught only by driving the real player route
  // in a browser; no automated test before this one would have failed.
  it('includes the seeded scene markers on the single-episode endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get(`/episodes/${PREMIUM_EPISODE_ID}`)
      .expect(200);

    const markers = (response.body as { episode: { sceneMarkers: unknown[] } })
      .episode.sceneMarkers;
    expect(Array.isArray(markers)).toBe(true);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'INTRO' })]),
    );
  });

  it('denies a premium episode to a user with no subscription', async () => {
    const response = await request(app.getHttpServer())
      .get(`/playback/${PREMIUM_EPISODE_ID}/authorize`)
      .set('Cookie', freeUserCookie)
      .expect(200);
    const authorization = response.body as {
      allowed: boolean;
      reason: string;
      videoUrl?: string;
    };

    expect(authorization).toMatchObject({
      allowed: false,
      reason: 'subscription_required',
    });
    expect(authorization.videoUrl).toBeUndefined();
  });

  it('does not activate paid access from an unverified browser request', async () => {
    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Cookie', freeUserCookie)
      .send({ planId: 'monthly' })
      .expect(503);

    const response = await request(app.getHttpServer())
      .get(`/playback/${PREMIUM_EPISODE_ID}/authorize`)
      .set('Cookie', freeUserCookie)
      .expect(200);
    expect(response.body).toMatchObject({
      allowed: false,
      reason: 'subscription_required',
    });
  });

  it('does not serve draft movies publicly', async () => {
    const list = await request(app.getHttpServer()).get('/movies').expect(200);
    const ids = (list.body as { id: string }[]).map((movie) => movie.id);

    expect(ids).not.toContain(DRAFT_MOVIE_ID);
    await request(app.getHttpServer())
      .get(`/movies/${DRAFT_MOVIE_ID}`)
      .expect(404);
  });
});
