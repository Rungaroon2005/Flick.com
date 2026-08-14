import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const PREMIUM_EPISODE_ID = 'sathu-premium';
const DRAFT_MOVIE_ID = 'e2e-draft';

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
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'e2e-free@flick.test',
        password: 'flick-e2e-password',
      })
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

  it('denies a premium episode to a user with no subscription and no coins', async () => {
    const response = await request(app.getHttpServer())
      .get(`/playback/${PREMIUM_EPISODE_ID}/authorize`)
      .set('Cookie', freeUserCookie)
      .expect(200);
    const authorization = response.body as {
      allowed: boolean;
      reason: string;
      coinCost: number;
      videoUrl?: string;
    };

    expect(authorization).toMatchObject({
      allowed: false,
      reason: 'coins_required',
      coinCost: 10,
    });
    expect(authorization.videoUrl).toBeUndefined();
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
